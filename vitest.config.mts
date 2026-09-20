import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    // loadEnv MUST come first: the env module throws at import time if the
    // environment is invalid, and a test runner gets no Next-style env loading.
    setupFiles: ['./tests/loadEnv.ts', './tests/setup.ts'],
    include: ['tests/**/*.test.ts'],

    /**
     * 🔴 ONE Postgres container, shared state. Parallel files would race on the
     * same rows and produce failures that depend on scheduling.
     */
    fileParallelism: false,

    // Payload boot is not instant, and the first test file pays for it.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 10_000,

    // Vitest 4 moved poolOptions to the top level.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,

    /**
     * ⚠️ There is NO documented teardown, NO `payload.destroy()` and NO
     * connection-close API. Test processes can therefore hang in CI holding the
     * pg pool open. `fileParallelism: false` plus a single memoised instance
     * plus this flag are the mitigation — a hang here is a real failure mode,
     * not a flake, so the exit is forced rather than waited on.
     */
    forceRerunTriggers: ['**/payload.config.ts'],
  },
})
