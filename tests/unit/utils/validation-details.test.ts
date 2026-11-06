import { z } from 'zod';
import { toValidationDetails } from '../../../src/utils/validation-details';

function issuesOf(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value, { reportInput: true });
  if (result.success) throw new Error('expected a failure');
  return toValidationDetails(result.error);
}

describe('toValidationDetails', () => {
  it('joins nested paths with dots, including array indexes', () => {
    const schema = z.object({
      features: z.object({ tableBooking: z.boolean('bad') }),
      cuisines: z.array(z.string('bad')),
    });

    expect(
      issuesOf(schema, { features: { tableBooking: 1 }, cuisines: ['a', 2] }),
    ).toEqual([
      { path: 'features.tableBooking', code: 'invalid_type', message: 'bad' },
      { path: 'cuisines.1', code: 'invalid_type', message: 'bad' },
    ]);
  });

  it('splits unrecognized keys into one detail per key at its own path', () => {
    const schema = z.strictObject({
      features: z.strictObject({ tableBooking: z.boolean().optional() }),
    });

    expect(issuesOf(schema, { a: 1, b: 2, features: { c: 3 } })).toEqual([
      { path: 'features.c', code: 'unknown_field', message: 'Unknown field' },
      { path: 'a', code: 'unknown_field', message: 'Unknown field' },
      { path: 'b', code: 'unknown_field', message: 'Unknown field' },
    ]);
  });

  it('tells a missing field (required) from a wrong one (invalid_type)', () => {
    const schema = z.object({ a: z.string(), b: z.string() });

    expect(issuesOf(schema, { b: 1 }).map((d) => d.code)).toEqual([
      'required',
      'invalid_type',
    ]);
  });

  it('uses the detailCode a custom issue names, else custom', () => {
    const schema = z.string().superRefine((_value, context) => {
      context.addIssue({
        code: 'custom',
        message: 'm',
        params: { detailCode: 'required' },
      });
      context.addIssue({
        code: 'custom',
        message: 'n',
        params: { detailCode: 'bogus' },
      });
      context.addIssue({ code: 'custom', message: 'o' });
    });

    expect(issuesOf(schema, 'x').map((d) => d.code)).toEqual([
      'required',
      'custom',
      'custom',
    ]);
  });

  it('maps format and value issues', () => {
    expect(issuesOf(z.string().regex(/^a$/), 'b')[0]?.code).toBe(
      'invalid_format',
    );
    expect(issuesOf(z.enum(['a']), 'b')[0]?.code).toBe('invalid_value');
  });

  it('uses an empty path for a root-level issue', () => {
    expect(issuesOf(z.object({}, 'not an object'), null)).toEqual([
      { path: '', code: 'invalid_type', message: 'not an object' },
    ]);
  });
});
