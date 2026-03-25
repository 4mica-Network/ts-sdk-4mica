import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'dist/**',
      'node_modules/**',
      'tests/**/*.e2e.test.ts',
      ...(process.env.CI ? ['tests/**/*.integration.test.ts'] : []),
    ],
  },
});
