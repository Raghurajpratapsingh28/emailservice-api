import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/e2e/**/*.test.ts'],
      testTimeout: 60000,
      hookTimeout: 60000,
    },
  }),
);
