import { loadEnv } from '../../../src/config/env';

const MONGODB_URI =
  'mongodb://user:pass@localhost:27017/biteexpress?authSource=admin&directConnection=true';

describe('loadEnv', () => {
  it('applies defaults when only MONGODB_URI is set', () => {
    expect(loadEnv({ MONGODB_URI })).toEqual({
      PORT: 3000,
      NODE_ENV: 'development',
      MONGODB_URI,
    });
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
});
