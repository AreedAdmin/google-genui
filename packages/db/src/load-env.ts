import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Loads the monorepo-root `.env` into process.env. Import this FIRST in the
 * migrate entrypoint. dotenv parses values literally (no shell `$`-expansion),
 * so a DATABASE_URL whose password contains `$` is preserved exactly.
 */
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
