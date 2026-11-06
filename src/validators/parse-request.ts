import type { z } from 'zod';

/**
 * Parses request input, throwing the ZodError for the error handler.
 * `reportInput` lets toValidationDetails tell a missing field (`required`)
 * from a wrong one (`invalid_type`): the issue's `input` is then undefined
 * exactly when the field is missing. The input never reaches the response.
 */
export function parseRequest<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value, { reportInput: true });
  if (!result.success) throw result.error;
  return result.data;
}

/**
 * `?minRating=` (a blank value, common in form-built URLs) means "not given".
 * Without this, z.coerce.number() would read it as 0.
 */
export function withoutBlankValues(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) => !(typeof value === 'string' && value.trim() === ''),
    ),
  );
}
