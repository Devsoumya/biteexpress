import {
  DETAIL_CODES,
  ERROR_CATALOG,
  ERROR_CODES,
} from '../../../src/constants/error-codes';
import { ApplicationError } from '../../../src/utils/application-error';

describe('error catalog', () => {
  it.each(ERROR_CODES)('%s has a 4xx or 5xx status', (code) => {
    expect(ERROR_CATALOG[code].status).toBeGreaterThanOrEqual(400);
    expect(ERROR_CATALOG[code].status).toBeLessThan(600);
  });

  it('marks exactly the 503s as retryable (Retry-After)', () => {
    for (const code of ERROR_CODES) {
      const spec: { status: number; retryable?: true } = ERROR_CATALOG[code];
      expect(spec.retryable === true).toBe(spec.status === 503);
    }
  });

  it('uses UPPER_SNAKE_CASE codes and snake_case detail codes', () => {
    for (const code of ERROR_CODES) expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    for (const code of DETAIL_CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('gives an ApplicationError the status and retryability of its code', () => {
    const error = new ApplicationError('SEARCH_TIMEOUT', 'slow');

    expect(error).toMatchObject({
      statusCode: 503,
      retryable: true,
      code: 'SEARCH_TIMEOUT',
    });
    expect(new ApplicationError('INVALID_ID', 'x').retryable).toBe(false);
  });
});
