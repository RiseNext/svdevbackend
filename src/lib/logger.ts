import pino, { type Logger } from 'pino'

import { env, isProduction } from './env'

/**
 * A PRE-INSTANTIATED pino logger, passed to `buildConfig({ logger })`.
 *
 * 🔴 NEVER use Pino `transport`. The Payload docs warn it fails with
 * "unable to determine transport target" under ESM/bundling, and Payload is
 * fully ESM. In development we therefore wire pino-pretty as a DESTINATION
 * STREAM (synchronous, in-process), not as a transport worker.
 *
 * 🔴 NEVER `pino.destination('/var/log/...')` — the official Dockerfile runs as
 * USER nextjs (uid 1001), which cannot write there.
 *
 * Production: the default JSON-to-stdout, collected by the container log driver.
 * That IS structured logging; no extra work is required.
 */

/**
 * PII and secret redaction. Payload will happily log a whole document, and lead
 * documents carry name + phone. `SECURITY.md` §13 forbids logging phone numbers,
 * hashes, salts and cookie values.
 */
const redact = {
  paths: [
    'password',
    '*.password',
    '*.hash',
    '*.salt',
    'hash',
    'salt',
    'req.headers.cookie',
    'req.headers.authorization',
    'headers.cookie',
    'headers.authorization',
    '*.phone',
    '*.phoneNormalised',
    '*.ipAddress',
    '*.userAgent',
    'PAYLOAD_SECRET',
    'DATABASE_URL',
    '*.accessKeyId',
    '*.secretAccessKey',
    '*.SMTP_PASS',
  ],
  censor: '[redacted]',
}

const base = {
  level: env.DISABLE_LOGGING ? 'silent' : env.LOG_LEVEL,
  redact,
  // The default includes pid + hostname. `hostname` in a container is the
  // container id, which is noise; keep pid for correlating worker processes.
  base: { pid: process.pid },
} satisfies pino.LoggerOptions

function createLogger(): Logger {
  if (isProduction || env.DISABLE_LOGGING) {
    return pino(base)
  }

  // Development only. `pino-pretty` is required lazily and used as a STREAM so
  // that a missing devDependency degrades to plain JSON instead of crashing the
  // production build, and so no transport worker is ever spawned.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pretty = require('pino-pretty')
    return pino(
      base,
      pretty({ colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid' }),
    ) as unknown as Logger
  } catch {
    return pino(base)
  }
}

export const logger: Logger = createLogger()

/** `req_` + a sortable random id. Ours, and deliberately NOT a resource id:
 *  resource ids are Postgres UUIDs and nothing in the frontend parses one. */
export const newRequestId = (): string =>
  `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase()
