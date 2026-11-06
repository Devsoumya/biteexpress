import { loadEnv } from '../../../src/config/env';

const MONGODB_URI =
  'mongodb://user:pass@localhost:27017/biteexpress?authSource=admin&directConnection=true';

describe('loadEnv', () => {
  it('applies defaults when only MONGODB_URI is set', () => {
    expect(loadEnv({ MONGODB_URI })).toEqual({
      PORT: 3000,
      NODE_ENV: 'development',
      MONGODB_URI,
      TENANT_ID: 'biteexpress',
      SEARCH_INDEX_NAME: 'restaurants_search',
      QUERY_MAX_TIME_MS: 2000,
      BEST_MIN_VOTES: 20,
      VOCABULARY_REFRESH_MS: 86400000,
      SLOW_REQUEST_MS: 500,
      LOG_LEVEL: 'info',
      SEED_CSV_PATH: 'zomato_data.csv',
    });
  });

  it('rejects a vocabulary refresh interval longer than a Node timer can wait', () => {
    expect(() =>
      loadEnv({ MONGODB_URI, VOCABULARY_REFRESH_MS: '2147483648' }),
    ).toThrow();
    expect(
      loadEnv({ MONGODB_URI, VOCABULARY_REFRESH_MS: '2147483647' })
        .VOCABULARY_REFRESH_MS,
    ).toBe(2147483647);
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ MONGODB_URI, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing MONGODB_URI', () => {
    expect(() => loadEnv({})).toThrow();
  });

  it('rejects a URI that is not a MongoDB URI', () => {
    expect(() => loadEnv({ MONGODB_URI: 'http://localhost:27017' })).toThrow(
      'Must be a MongoDB connection URI',
    );
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => loadEnv({ MONGODB_URI, PORT: '70000' })).toThrow();
  });

  it('coerces numeric settings from strings', () => {
    const env = loadEnv({
      MONGODB_URI,
      QUERY_MAX_TIME_MS: '500',
      BEST_MIN_VOTES: '0',
    });

    expect(env.QUERY_MAX_TIME_MS).toBe(500);
    expect(env.BEST_MIN_VOTES).toBe(0);
  });

  it.each([
    ['QUERY_MAX_TIME_MS', '0'],
    ['BEST_MIN_VOTES', '-1'],
    ['LOG_LEVEL', 'verbose'],
    ['TENANT_ID', ''],
    ['SEARCH_INDEX_NAME', ''],
  ])('rejects %s=%j', (name, value) => {
    expect(() => loadEnv({ MONGODB_URI, [name]: value })).toThrow();
  });
});
