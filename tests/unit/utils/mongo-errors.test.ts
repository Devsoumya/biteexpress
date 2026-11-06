import {
  MongoClient,
  MongoNetworkError,
  MongoNetworkTimeoutError,
  MongoOperationTimeoutError,
  MongoServerError,
  MongoTopologyClosedError,
} from 'mongodb';
import {
  classifyMongoError,
  failureCode,
} from '../../../src/utils/mongo-errors';

// Port 1 refuses connections at once: a real MongoServerSelectionError.
async function serverSelectionError(): Promise<unknown> {
  const client = new MongoClient(
    'mongodb://127.0.0.1:1/x?directConnection=true',
    { serverSelectionTimeoutMS: 100 },
  );
  try {
    return await client
      .db()
      .command({ ping: 1 })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
  } finally {
    await client.close();
  }
}

describe('classifyMongoError', () => {
  it.each<[string, unknown, string]>([
    [
      'operation timeout (CSOT)',
      new MongoOperationTimeoutError('t'),
      'timeout',
    ],
    ['socket timeout', new MongoNetworkTimeoutError('t'), 'timeout'],
    [
      'MaxTimeMSExpired (50)',
      new MongoServerError({ message: 'm', code: 50 }),
      'timeout',
    ],
    [
      'ExceededTimeLimit (262)',
      new MongoServerError({ message: 'm', code: 262 }),
      'timeout',
    ],
    ['network error', new MongoNetworkError('reset'), 'unavailable'],
    ['client closed (shutdown)', new MongoTopologyClosedError(), 'unavailable'],
    [
      'primary stepped down (189)',
      new MongoServerError({ message: 'm', code: 189 }),
      'unavailable',
    ],
    [
      'shutdown in progress (91)',
      new MongoServerError({ message: 'm', code: 91 }),
      'unavailable',
    ],
    [
      'validator rejection (121)',
      new MongoServerError({ message: 'm', code: 121 }),
      'other',
    ],
    [
      'duplicate key (11000)',
      new MongoServerError({ message: 'm', code: 11000 }),
      'other',
    ],
    ['a plain Error', new Error('bug'), 'other'],
    ['a non-error', 'oops', 'other'],
  ])('%s → %s', (_case, error, kind) => {
    expect(classifyMongoError(error)).toBe(kind);
  });

  it('classifies a real server selection failure as unavailable', async () => {
    expect(classifyMongoError(await serverSelectionError())).toBe(
      'unavailable',
    );
  });
});

describe('failureCode', () => {
  it.each<[unknown, 'database' | 'search', string | undefined]>([
    [new MongoOperationTimeoutError('t'), 'database', 'DATABASE_TIMEOUT'],
    [new MongoNetworkError('r'), 'database', 'DATABASE_UNAVAILABLE'],
    [new MongoOperationTimeoutError('t'), 'search', 'SEARCH_TIMEOUT'],
    [new MongoNetworkError('r'), 'search', 'SEARCH_UNAVAILABLE'],
    [new Error('bug'), 'search', undefined],
  ])('%s on %s → %s', (error, engine, code) => {
    expect(failureCode(error, engine)).toBe(code);
  });
});
