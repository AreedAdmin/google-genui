import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { logger } from "./log.js";

const log = logger("repo-summary");

/**
 * Build a compact repo-context block for the Planner (prompts-and-tools.md §3):
 * file layout, key config (package.json name/scripts/deps), top-level module dirs,
 * and detected conventions (test framework, migration dir). Kept small (summaries,
 * not source). Best-effort — any read error degrades to a partial summary.
 */

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo"]);
const MAX_FILES = 200;

export async function buildRepoSummary(repoPath: string, isSample: boolean): Promise<string> {
  const parts: string[] = [];
  if (isSample) {
    parts.push("NOTE: the real repo was unavailable; this is a generated SAMPLE scaffold. Predict conservatively and mark new symbols in `add`.");
  }

  // package.json conventions.
  try {
    const pkgRaw = await readFile(join(repoPath, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    parts.push(`## package.json\nname: ${pkg.name ?? "(unnamed)"}`);
    if (pkg.scripts) parts.push(`scripts: ${Object.keys(pkg.scripts).join(", ")}`);
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const framework = detectFramework(deps);
    if (framework) parts.push(`detected: ${framework}`);
  } catch {
    /* no package.json */
  }

  // File tree (top of repo, bounded).
  try {
    const files = await walk(repoPath, repoPath, 0);
    const dirs = new Set<string>();
    for (const f of files) {
      const top = f.split("/")[0];
      if (top && !top.includes(".")) dirs.add(top);
    }
    parts.push(`## Top-level dirs\n${[...dirs].slice(0, 30).join(", ")}`);
    parts.push(`## Files (first ${Math.min(files.length, 80)})\n${files.slice(0, 80).join("\n")}`);

    // Convention sniffing.
    const conventions: string[] = [];
    if (files.some((f) => /migrations?\//i.test(f))) conventions.push("has a migrations/ dir");
    if (files.some((f) => /prisma\//i.test(f))) conventions.push("uses Prisma");
    if (files.some((f) => /\.(test|spec)\.[tj]sx?$/.test(f))) conventions.push("colocated *.test/*.spec tests");
    if (files.some((f) => /__tests__\//.test(f))) conventions.push("__tests__ dirs");
    if (conventions.length) parts.push(`## Conventions\n${conventions.join("; ")}`);
  } catch (err) {
    log.warn(`walk failed: ${(err as Error).message}`);
  }

  return parts.join("\n\n");
}

function detectFramework(deps: Record<string, string>): string | null {
  const hits: string[] = [];
  if (deps.next) hits.push("Next.js");
  if (deps.fastify) hits.push("Fastify");
  if (deps.express) hits.push("Express");
  if (deps.react) hits.push("React");
  if (deps["@supabase/supabase-js"]) hits.push("Supabase");
  if (deps.prisma || deps["@prisma/client"]) hits.push("Prisma");
  if (deps.vitest) hits.push("Vitest");
  if (deps.jest) hits.push("Jest");
  return hits.length ? hits.join(", ") : null;
}

async function walk(root: string, dir: string, depth: number, acc: string[] = []): Promise<string[]> {
  if (acc.length >= MAX_FILES || depth > 4) return acc;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) break;
    if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(root, full, depth + 1, acc);
    } else if (e.isFile()) {
      acc.push(relative(root, full));
    }
  }
  return acc;
}
