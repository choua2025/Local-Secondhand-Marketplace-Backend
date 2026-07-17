import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],

    // Creates the test database and runs the migrations, once.
    globalSetup: ['./test/setup/globalSetup.ts'],

    // Points DATABASE_URL at the test database before src/db.ts builds its Pool.
    setupFiles: ['./test/setup/env.ts'],

    /**
     * Test files share one database, and each one TRUNCATEs it between tests.
     * Running files in parallel would have them wiping each other's rows
     * mid-assertion. Sequential is the correct answer here; the suite is I/O
     * bound on Postgres, not CPU bound, so the wall-clock cost is small.
     */
    fileParallelism: false,

    // The concurrency test fires 20 simultaneous requests and waits on locks.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
