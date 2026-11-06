import type { ZodError } from 'zod';
import { DETAIL_CODES, type DetailCode } from '../constants/error-codes';
import type { ErrorDetail } from '../models/error.model';

type ZodIssue = ZodError['issues'][number];

function joinPath(path: readonly PropertyKey[]): string {
  return path.map(String).join('.');
}

function isDetailCode(value: unknown): value is DetailCode {
  return DETAIL_CODES.includes(value as DetailCode);
}

/**
 * Maps a Zod issue to our stable detail code. Custom issues may name one in
 * `params.detailCode` (for example "longitude is required with latitude").
 */
function detailCode(issue: ZodIssue): DetailCode {
  switch (issue.code) {
    case 'invalid_type':
      // With reportInput (parseRequest), `input` is undefined exactly when the
      // field is missing. Without it there is no `input` key, and a missing
      // field cannot be told apart, so the safe answer is invalid_type.
      return 'input' in issue && issue.input === undefined
        ? 'required'
        : 'invalid_type';
    case 'too_small':
      return 'too_small';
    case 'too_big':
      return 'too_large';
    case 'invalid_format':
      return 'invalid_format';
    case 'custom': {
      const requested: unknown = issue.params?.['detailCode'];
      return isDetailCode(requested) ? requested : 'custom';
    }
    default:
      return 'invalid_value';
  }
}

/**
 * Field-level details for a 400. Zod reports unknown keys as one issue on the
 * parent object, so they are split into one detail per key, at the key's own
 * path, which is where a client looks for it.
 */
export function toValidationDetails(error: ZodError): ErrorDetail[] {
  return error.issues.flatMap((issue): ErrorDetail[] =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({
          path: joinPath([...issue.path, key]),
          code: 'unknown_field',
          message: 'Unknown field',
        }))
      : [
          {
            path: joinPath(issue.path),
            code: detailCode(issue),
            message: issue.message,
          },
        ],
  );
}
