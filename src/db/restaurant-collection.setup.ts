import type { Collection, Db, Document } from 'mongodb';
import type { SearchIndexChange } from '../models/seed.model';
import { RESTAURANT_JSON_SCHEMA } from './restaurant.json-schema';

// Schema and index management: the migration-job code of ADR-004. Only the
// seed script and the test setup call it; the API never creates indexes or
// applies the validator (AGENTS.md invariant 20).

export const UNIQUE_SOURCE_INDEX = 'uq_tenant_source';

/** Creates the collection with the validator, or applies it to an existing one. */
export async function applyValidator(
  db: Db,
  collectionName: string,
): Promise<void> {
  const options = {
    validator: { $jsonSchema: RESTAURANT_JSON_SCHEMA },
    validationLevel: 'strict',
    validationAction: 'error',
  } as const;

  const exists =
    (await db.listCollections({ name: collectionName }).toArray()).length > 0;
  if (exists) {
    await db.command({ collMod: collectionName, ...options });
  } else {
    await db.createCollection(collectionName, options);
  }
}

/** Idempotent: createIndex with the same name and options is a no-op. */
export async function ensureIndexes<T extends Document>(
  collection: Collection<T>,
): Promise<void> {
  await collection.createIndex(
    { tenantId: 1, sourceId: 1 },
    {
      name: UNIQUE_SOURCE_INDEX,
      unique: true,
      // POST-created restaurants have no sourceId and must not collide.
      partialFilterExpression: { sourceId: { $exists: true } },
    },
  );
}

// Analyzer filter chains apply in order; every other array in a search index
// definition is a set (field type lists, storedSource paths), and the server
// stores sets in its own order (it sorts storedSource.include, for example).
const ORDERED_ARRAY_KEYS = new Set(['tokenFilters', 'charFilters']);

function arrayCovers(
  stored: unknown[],
  expected: unknown[],
  ordered: boolean,
): boolean {
  if (stored.length !== expected.length) return false;
  if (ordered) {
    return expected.every((item, i) => definitionCovers(stored[i], item));
  }
  const unmatched = [...stored];
  return expected.every((item) => {
    const i = unmatched.findIndex((candidate) =>
      definitionCovers(candidate, item),
    );
    if (i === -1) return false;
    unmatched.splice(i, 1);
    return true;
  });
}

/**
 * True when `stored` has every value `expected` defines. The server adds
 * defaults to a stored search index definition (for example `store`,
 * `norms`, `indexOptions`) and reorders keys and set-like arrays, so a plain
 * equality check would report a change on every run.
 */
export function definitionCovers(
  stored: unknown,
  expected: unknown,
  key = '',
): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(stored) &&
      arrayCovers(stored, expected, ORDERED_ARRAY_KEYS.has(key))
    );
  }
  if (typeof expected === 'object' && expected !== null) {
    if (typeof stored !== 'object' || stored === null) return false;
    const storedRecord = stored as Record<string, unknown>;
    return Object.entries(expected).every(([childKey, value]) =>
      definitionCovers(storedRecord[childKey], value, childKey),
    );
  }
  return stored === expected;
}

async function findSearchIndex<T extends Document>(
  collection: Collection<T>,
  name: string,
): Promise<Document | undefined> {
  // The driver types listings as { name }; the server returns more fields.
  const [index]: Document[] = await collection
    .listSearchIndexes(name)
    .toArray();
  return index;
}

/** Creates the search index if missing, updates it if the definition changed. */
export async function ensureSearchIndex<T extends Document>(
  collection: Collection<T>,
  name: string,
  definition: Document,
): Promise<SearchIndexChange> {
  const existing = await findSearchIndex(collection, name);
  if (!existing) {
    await collection.createSearchIndex({ name, definition });
    return 'created';
  }
  if (definitionCovers(existing['latestDefinition'], definition)) {
    return 'unchanged';
  }
  await collection.updateSearchIndex(name, definition);
  return 'updated';
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Polls until the index is READY and queryable. Verified on atlas-local: after
 * create or update the status leaves READY at once (PENDING, then BUILDING),
 * so READY here always means the latest definition.
 */
export async function waitForSearchIndex<T extends Document>(
  collection: Collection<T>,
  name: string,
  { timeoutMs = 60_000, intervalMs = 250 }: WaitOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 'not listed';
  for (;;) {
    const index = await findSearchIndex(collection, name);
    if (index?.['status'] === 'READY' && index['queryable'] === true) return;
    last = index
      ? `${String(index['status'])}, queryable ${String(index['queryable'])}`
      : 'not listed';
    if (Date.now() >= deadline) {
      throw new Error(
        `Search index "${name}" not queryable after ${timeoutMs} ms (last: ${last})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
