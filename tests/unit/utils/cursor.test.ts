import type { SearchCriteria } from '../../../src/models/search.model';
import { ApplicationError } from '../../../src/utils/application-error';
import {
  criteriaFingerprint,
  decodeCursor,
  encodeCursor,
} from '../../../src/utils/cursor';

const gurgaonByRating: SearchCriteria = {
  city: 'gurgaon',
  cuisineMatch: 'any',
  sort: 'rating',
};

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof ApplicationError
      ? error.code
      : 'not an ApplicationError';
  }
}

describe('cursor', () => {
  it('round-trips the token for the same query', () => {
    const cursor = encodeCursor('token-123', gurgaonByRating);

    expect(decodeCursor(cursor, { ...gurgaonByRating })).toBe('token-123');
  });

  it('is opaque URL-safe text', () => {
    expect(encodeCursor('a/b+c=', gurgaonByRating)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each<[string, SearchCriteria]>([
    ['another sort', { ...gurgaonByRating, sort: 'cost', currency: 'INR' }],
    ['another city', { ...gurgaonByRating, city: 'new delhi' }],
    ['an added filter', { ...gurgaonByRating, minRating: 4 }],
    ['another origin', { ...gurgaonByRating, origin: { lat: 1, lng: 2 } }],
  ])('rejects the cursor for %s with CURSOR_INVALID', (_case, other) => {
    const cursor = encodeCursor('token', gurgaonByRating);

    expect(codeOf(() => decodeCursor(cursor, other))).toBe('CURSOR_INVALID');
  });

  it.each([
    ['not base64 JSON', '%%%'],
    ['JSON of the wrong shape', Buffer.from('{"x":1}').toString('base64url')],
    [
      'an unknown version',
      Buffer.from('{"v":2,"t":"a","q":"b"}').toString('base64url'),
    ],
  ])('rejects %s with CURSOR_INVALID', (_case, cursor) => {
    expect(codeOf(() => decodeCursor(cursor, gurgaonByRating))).toBe(
      'CURSOR_INVALID',
    );
  });

  it('fingerprints equal criteria equally, whatever the key or cuisine order', () => {
    expect(
      criteriaFingerprint({
        cuisineMatch: 'any',
        cuisines: ['b', 'a'],
        city: 'x',
      }),
    ).toBe(
      criteriaFingerprint({
        city: 'x',
        cuisines: ['a', 'b'],
        cuisineMatch: 'any',
      }),
    );
  });
});
