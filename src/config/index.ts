import { z } from 'zod';

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  APP_NAME: z.string().default('engageiq-api'),
  APP_VERSION: z.string().default('1.0.0'),

  // HTTP server
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().nonnegative().default(4000),
  TRUST_PROXY: z
    .union([z.string(), z.boolean()])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .default(true),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // Public URLs
  APP_PUBLIC_URL: z.string().url(),
  API_PUBLIC_URL: z.string().url(),

  // CORS
  CORS_ORIGINS: z.string().default(''),

  // PostgreSQL
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  DATABASE_IDLE_TIMEOUT_S: z.coerce.number().int().nonnegative().default(30),
  DATABASE_CONNECT_TIMEOUT_S: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: z
    .union([z.string(), z.boolean()])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .default(false),

  // Redis
  REDIS_URL: z.string().url(),
  REDIS_KEY_PREFIX: z.string().default('engageiq:'),

  // NATS
  NATS_URL: z.string().url(),
  NATS_NAME: z.string().default('engageiq-api'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  JWT_ISSUER: z.string().default('engageiq'),
  JWT_AUDIENCE: z.string().default('engageiq-api'),

  // Auth security
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  ACCOUNT_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  ACCOUNT_LOCKOUT_WINDOW_S: z.coerce.number().int().positive().default(900),
  ACCOUNT_LOCKOUT_DURATION_S: z.coerce.number().int().positive().default(900),
  PASSWORD_RESET_TTL_S: z.coerce.number().int().positive().default(3_600),
  EMAIL_VERIFICATION_TTL_S: z.coerce.number().int().positive().default(86_400),
  INVITE_TTL_S: z.coerce.number().int().positive().default(604_800),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_AUTH_WINDOW: z.string().default('1m'),

  // Internal auth
  INTERNAL_API_KEY: z.string().min(16),

  // Email
  EMAIL_FROM: z.string().email(),
  EMAIL_REPLY_TO: z.string().email().optional(),
  AWS_REGION: z.string().default('us-east-1'),

  // Swagger
  SWAGGER_ENABLED: z
    .union([z.string(), z.boolean()])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .default(true),
  SWAGGER_PATH: z.string().default('/docs'),

  // ─── Stripe billing ───────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_API_VERSION: z.string().default('2024-12-18.acacia'),
  /** Where Stripe Checkout redirects on success/cancel. Path appended; supports `{CHECKOUT_SESSION_ID}` placeholder. */
  STRIPE_CHECKOUT_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CHECKOUT_CANCEL_URL: z.string().url().optional(),
  STRIPE_PORTAL_RETURN_URL: z.string().url().optional(),
  /** Price IDs per (plan, interval). Required only for plans you want available in checkout. */
  STRIPE_STARTER_MONTHLY_PRICE_ID: z.string().optional(),
  STRIPE_STARTER_YEARLY_PRICE_ID: z.string().optional(),
  STRIPE_GROWTH_MONTHLY_PRICE_ID: z.string().optional(),
  STRIPE_GROWTH_YEARLY_PRICE_ID: z.string().optional(),
  STRIPE_PRO_MONTHLY_PRICE_ID: z.string().optional(),
  STRIPE_PRO_YEARLY_PRICE_ID: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  corsOrigins: string[];
};

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  const data = parsed.data;
  cached = {
    ...data,
    isProduction: data.NODE_ENV === 'production',
    isDevelopment: data.NODE_ENV === 'development',
    isTest: data.NODE_ENV === 'test',
    corsOrigins: data.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  };

  return cached;
}

/** For tests only: clears the cached config so a new env can be loaded. */
export function resetConfig(): void {
  cached = undefined;
}

export const config: AppConfig = loadConfig();
