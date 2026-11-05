import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  MONGODB_URI: z
    .string()
    .min(1)
    .regex(/^mongodb(\+srv)?:\/\//, 'Must be a MongoDB connection URI'),
  TENANT_ID: z.string().min(1).default('biteexpress'),
  SEARCH_INDEX_NAME: z.string().min(1).default('restaurants_search'),
  QUERY_MAX_TIME_MS: z.coerce.number().int().positive().default(2000),
  BEST_MIN_VOTES: z.coerce.number().int().nonnegative().default(20),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
