import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Loads `.env` for the TEST RUNNER only.
 *
 * 🔴 WHY THIS EXISTS AND WHY IT IS NOT `dotenv`:
 *
 * The rule "do not install dotenv" is about the APPLICATION: `svbackend` is a
 * Next.js app, Next's own loader is the mechanism, and adding a second loader
 * with different precedence produces a class of "works in the script, not in the
 * app" bug. That reasoning is sound and stands.
 *
 * But a TEST RUNNER gets neither Next's loader nor `payload run`'s. The plan
 * says so explicitly: "DATABASE_URL is set BEFORE the config is imported — a
 * test runner does not get `payload run`'s Next-style env loading, so the
 * runner's setup file loads env itself."
 *
 * So: twenty lines here rather than a dependency, and it is scoped to the test
 * process alone. It NEVER overwrites a variable that is already set, so CI can
 * pass DATABASE_URL on the command line and have it win over the local file.
 */

const parseEnvFile = (contents: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Strip matched surrounding quotes, if present.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const root = process.cwd()
for (const file of ['.env.test', '.env']) {
  const full = path.join(root, file)
  if (!existsSync(full)) continue
  const parsed = parseEnvFile(readFileSync(full, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) {
    // An explicitly-provided variable ALWAYS wins — that is how CI points the
    // suite at the disposable test database on port 5433.
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
    }
  }
}

// Tests run against the test database by default, never the dev sandbox, so a
// careless run cannot wipe the data a developer is looking at in the admin.
// NODE_ENV is typed readonly by @types/node, hence the indexed write.
if (!process.env.NODE_ENV) {
  ;(process.env as Record<string, string>)['NODE_ENV'] = 'test'
}
