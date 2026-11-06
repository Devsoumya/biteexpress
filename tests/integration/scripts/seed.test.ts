import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Collection,
  type MongoClient,
  MongoBulkWriteError,
} from 'mongodb';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import { describeSeedError, runSeed } from '../../../src/scripts/seed';
import {
  TEST_DB_NAME,
  TEST_SEARCH_INDEX_NAME,
  connectTestClient,
} from '../../helpers/test-database';

const TENANT = 'seed-run-test';

const HEADER =
  'Restaurant ID,Restaurant Name,Country Code,City,Address,Locality,Locality Verbose,Longitude,Latitude,Cuisines,Average Cost for two,Currency,Has Table booking,Has Online delivery,Is delivering now,Switch to order menu,Price range,Aggregate rating,Rating color,Rating text,Votes';

// Three real-shaped rows: a normal one, an unrated one with a quoted,
// multi-line address, and the known test row the seed must skip.
const CSV = [
  HEADER,
  '1001,Goli Vada Pav No. 1,1,Gurgaon,"Shop 12, Sector 29",Sector 29,"Sector 29, Gurgaon",77.0688,28.4595,"Street Food, Fast Food",300,Indian Rupees(Rs.),No,Yes,No,No,1,3.6,Yellow,Good,112',
  '1002,Summer Pavilion,1,New Delhi,"Ground Floor,\nCyber Hub",DLF Phase 2,"DLF Phase 2, New Delhi",0,0,Chinese,1500,Indian Rupees(Rs.),Yes,No,No,No,3,0,White,Not rated,2',
  '18419884,Test Restaruants for Medio,1,New Delhi,Test address,East of Kailash,"East of Kailash, New Delhi",34,35,"Chinese, Lucknowi",800,Indian Rupees(Rs.),Yes,No,No,No,2,0,White,Not rated,1',
  '',
].join('\n');

describe('runSeed', () => {
  let client: MongoClient;
  let restaurants: Collection;
  let directory: string;
  let csvPath: string;

  beforeAll(async () => {
    client = await connectTestClient();
    restaurants = client.db(TEST_DB_NAME).collection(RESTAURANTS_COLLECTION);
    directory = await mkdtemp(join(tmpdir(), 'biteexpress-seed-'));
    csvPath = join(directory, 'restaurants.csv');
    await writeFile(csvPath, CSV, 'utf8');
  });

  afterAll(async () => {
    await restaurants.deleteMany({ tenantId: TENANT });
    await rm(directory, { recursive: true, force: true });
    await client.close();
  });

  const seed = () =>
    runSeed(client.db(TEST_DB_NAME), {
      tenantId: TENANT,
      maxTimeMS: 2000,
      indexName: TEST_SEARCH_INDEX_NAME,
      csvPath,
      log: () => undefined,
    });

  it('loads the file and skips the test row', async () => {
    await expect(seed()).resolves.toMatchObject({
      rows: 3,
      mapped: 2,
      skipped: 1,
      skippedByReason: { 'test row': 1 },
      inserted: 2,
      updated: 0,
      searchIndex: 'unchanged',
    });

    const stored = await restaurants
      .find({ tenantId: TENANT }, { sort: { sourceId: 1 } })
      .toArray();
    expect(stored.map((r) => r['name'])).toEqual([
      'Goli Vada Pav No. 1',
      'Summer Pavilion',
    ]);
    expect(stored[1]).not.toHaveProperty('location');
    expect(stored[1]).not.toHaveProperty('rating.average');
    expect(stored[1]).toMatchObject({
      address: { line: 'Ground Floor, Cyber Hub' },
    });
  });

  it('inserts nothing when run again', async () => {
    await expect(seed()).resolves.toMatchObject({ inserted: 0, updated: 2 });
    await expect(
      restaurants.countDocuments({ tenantId: TENANT }),
    ).resolves.toBe(2);
  });

  it('fails on a validator rejection and reports the rule that failed', async () => {
    const longName = 'x'.repeat(201); // the validator allows 200 characters
    await writeFile(
      csvPath,
      [
        HEADER,
        CSV.split('\n')[1]
          ?.replace('Goli Vada Pav No. 1', longName)
          .replace('1001,', '1003,'),
        '',
      ].join('\n'),
      'utf8',
    );

    const error = await seed().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(MongoBulkWriteError);
    const report = describeSeedError(error);
    expect(report).toContain('1 write errors; first 1:');
    expect(report).toContain('"code":121');
    expect(report).toContain('maxLength');
  });

  it('describes other errors by their stack or message', () => {
    expect(describeSeedError(new Error('boom'))).toContain('boom');
    expect(describeSeedError('plain')).toBe('plain');
  });
});
