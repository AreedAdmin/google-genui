import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Loads the monorepo-root `.env` into process.env BEFORE any `env.ts` is
 * evaluated. Import this FIRST in every Node entrypoint. dotenv parses values
 * literally (no shell `$`-expansion), so secrets containing `$` — e.g. a DB
 * password — are preserved exactly (which `source .env` / compose would mangle).
 */
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
