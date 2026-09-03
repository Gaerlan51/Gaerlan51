import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // DB tests share one Postgres instance; run files serially so RLS
    // session state (request.jwt.claims) never leaks between them.
    fileParallelism: false,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
