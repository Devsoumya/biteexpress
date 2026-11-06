import type { Response } from 'supertest';
import {
  COMPONENT_SCHEMAS,
  type ComponentName,
  buildOpenApiDocument,
} from '../../src/openapi/openapi.document';

interface DocumentedResponse {
  description: string;
  content?: { 'application/json'?: { schema?: { $ref?: string } } };
}

type Paths = Record<
  string,
  Record<string, { responses: Record<string, DocumentedResponse> }>
>;

const { paths } = buildOpenApiDocument() as { paths: Paths };

/**
 * Asserts that the response's status is documented for the operation, that
 * an error code is one the documentation lists for that status, and that the
 * body parses with the documented (strict) schema. `path` is the
 * OpenAPI template, e.g. `/v1/restaurants/{id}`.
 */
export function expectDocumentedResponse(
  response: Response,
  method: string,
  path: string,
): void {
  const operation = paths[path]?.[method.toLowerCase()];
  if (!operation) throw new Error(`${method} ${path} is not documented`);

  const documented = operation.responses[String(response.status)];
  if (!documented) {
    throw new Error(
      `${method} ${path} returned ${response.status}, which is not documented`,
    );
  }

  const errorCode = (response.body as { error?: { code?: string } }).error
    ?.code;
  if (errorCode && !documented.description.includes(`\`${errorCode}\``)) {
    throw new Error(
      `${method} ${path} ${response.status} returned ${errorCode}, which its documentation does not list`,
    );
  }

  const ref = documented.content?.['application/json']?.schema?.$ref;
  if (!ref) return;
  const name = ref.replace('#/components/schemas/', '') as ComponentName;
  const result = COMPONENT_SCHEMAS[name].safeParse(response.body);
  if (!result.success) {
    throw new Error(
      `${method} ${path} ${response.status} does not match ${name}: ${JSON.stringify(result.error.issues)}`,
    );
  }
}
