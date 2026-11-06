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
  // Restaurants are not added daily, so 5 minutes is fresh enough; a POST
  // also refreshes the instance that handled it (ADR-002 Pass 4).
  VOCABULARY_REFRESH_MS: z.coerce.number().int().positive().default(300_000),
  // Read only by the seed script; relative paths resolve from the working
  // directory (the repo root on the host, /app in the image).
  SEED_CSV_PATH: z.string().min(1).default('zomato_data.csv'),
  // Above today's latencies (tens of ms), below QUERY_MAX_TIME_MS: flags
  // degradation before requests start timing out.
  SLOW_REQUEST_MS: z.coerce.number().int().nonnegative().default(500),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
