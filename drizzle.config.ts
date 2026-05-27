import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/shared/database/schema/index.ts',
  out: './database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/engageiq',
  },
  strict: true,
  verbose: true,
  casing: 'snake_case',
});
