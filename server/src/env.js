/**
 * Environment loading, in a module of its own, imported FIRST by the server.
 *
 * This file exists because of how ES modules actually run, which bit this project
 * once already. `import` declarations are not statements in the importing file's
 * body: every module they name is evaluated, top to bottom, *before* a single line
 * of the importer's own body executes. So when `dotenv.config()` sat in the middle
 * of server.js, every module-level `process.env` read elsewhere had already run and
 * seen an empty environment - db.js's database path override, authRoutes.js's
 * JWT_SECRET, the duplicate in auth.js, the Paytm configuration, the order
 * auto-progression flag. Whatever those modules captured at that moment was what
 * the whole process used for its lifetime.
 *
 * That is silent and it is fatal for a credential: an integration reading
 * `process.env.MSG91_AUTHKEY` at the top of a module would get `undefined`, find no
 * reason why, and either refuse every sign-in or fall back to something invented.
 * Importing this file first makes dotenv run before any of those reads, so a key
 * added to server/.env is genuinely present in the process that uses it.
 *
 * The path is resolved from this file's own location rather than from the current
 * working directory, so the .env next to server/package.json is found however the
 * server was launched. Nothing here is logged, echoed, or exported: a module whose
 * only job is to have run is the whole design, and a value that never leaves a
 * variable cannot leak through a stray console.log.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(here, '..', '.env') });
