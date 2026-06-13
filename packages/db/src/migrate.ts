import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

/**
 * Minimal forward-only migration runner. Applies migrations/*.sql in lexical
 * order inside a single transaction each, tracking applied files in
 * `_trellis_migrations`. For local dev / MVP — production would use Supabase CLI.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString });
  await client.connect();

  await client.query(`
    create table if not exists _trellis_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Set(
    (await client.query<{ name: string }>("select name from _trellis_migrations")).rows.map(
      (r) => r.name,
    ),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`• skip ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`▸ applying ${file} ...`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _trellis_migrations(name) values ($1)", [file]);
      await client.query("commit");
      console.log(`✓ applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`✗ failed ${file}`);
      throw err;
    }
  }

  await client.end();
  console.log("migrations complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
