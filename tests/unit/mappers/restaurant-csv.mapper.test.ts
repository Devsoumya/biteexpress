import {
  mapCsvRow,
  mapCsvRows,
} from '../../../src/mappers/restaurant-csv.mapper';
import type { CsvRow } from '../../../src/models/seed.model';

// A real row (Restaurant ID 308322), with every column the CSV has.
function csvRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    'Restaurant ID': '308322',
    'Restaurant Name': 'Goli Vada Pav No. 1',
    'Country Code': '1',
    City: 'Gurgaon',
    Address: 'Shop 12, Sector 29 Market',
    Locality: 'Sector 29',
    'Locality Verbose': 'Sector 29, Gurgaon',
    Longitude: '77.0688',
    Latitude: '28.4595',
    Cuisines: 'Street Food, Fast Food',
    'Average Cost for two': '300',
    Currency: 'Indian Rupees(Rs.)',
    'Has Table booking': 'No',
    'Has Online delivery': 'Yes',
    'Is delivering now': 'No',
    'Switch to order menu': 'No',
    'Price range': '1',
    'Aggregate rating': '3.6',
    'Rating color': 'Yellow',
    'Rating text': 'Good',
    Votes: '112',
    ...overrides,
  };
}

describe('mapCsvRow', () => {
  it('maps a complete row to the ADR-001 document shape', () => {
    expect(mapCsvRow(csvRow())).toEqual({
      sourceId: 308322,
      name: 'Goli Vada Pav No. 1',
      address: {
        line: 'Shop 12, Sector 29 Market',
        locality: 'Sector 29',
        city: 'Gurgaon',
      },
      country: { code: 'IN', name: 'India' },
      location: { type: 'Point', coordinates: [77.0688, 28.4595] },
      cuisines: ['Street Food', 'Fast Food'],
      cost: { averageForTwo: 300, currency: 'INR', priceRange: 1 },
      features: {
        tableBooking: false,
        onlineDelivery: true,
        deliveringNow: false,
      },
      rating: { average: 3.6, votes: 112 },
      norm: { city: 'gurgaon', cuisines: ['street food', 'fast food'] },
      schemaVersion: 1,
    });
  });

  it('skips the known test row', () => {
    expect(mapCsvRow(csvRow({ 'Restaurant ID': '18419884' }))).toEqual({
      skip: true,
      sourceId: 18419884,
      reason: 'test row',
    });
  });

  it('skips an unknown country code', () => {
    expect(mapCsvRow(csvRow({ 'Country Code': '999' }))).toEqual({
      skip: true,
      sourceId: 308322,
      reason: 'unknown country code',
    });
  });

  it('omits the average for an unrated restaurant but keeps votes', () => {
    expect(
      mapCsvRow(csvRow({ 'Aggregate rating': '0', Votes: '3' })),
    ).toMatchObject({ rating: { votes: 3 } });
    expect(mapCsvRow(csvRow({ 'Aggregate rating': '0' }))).not.toHaveProperty(
      'rating.average',
    );
  });

  it('omits the cost for 0 but keeps currency and price range', () => {
    const restaurant = mapCsvRow(csvRow({ 'Average Cost for two': '0' }));

    expect(restaurant).toMatchObject({
      cost: { currency: 'INR', priceRange: 1 },
    });
    expect(restaurant).not.toHaveProperty('cost.averageForTwo');
  });

  it.each([
    ['0', '0'],
    ['28.4595', '0'],
    ['0', '77.0688'],
  ])('omits the location for latitude %s, longitude %s', (lat, lng) => {
    expect(
      mapCsvRow(csvRow({ Latitude: lat, Longitude: lng })),
    ).not.toHaveProperty('location');
  });

  it('takes the currency from the country, not the CSV column', () => {
    expect(
      mapCsvRow(
        csvRow({
          'Country Code': '162',
          City: 'Makati City',
          Currency: 'Botswana Pula(P)',
        }),
      ),
    ).toMatchObject({
      country: { code: 'PH', name: 'Philippines' },
      cost: { currency: 'PHP' },
    });
  });

  it.each([
    ['14', 'AUD'],
    ['37', 'CAD'],
    ['184', 'SGD'],
    ['216', 'USD'],
  ])('gives "Dollar($)" country %s its own currency %s', (code, currency) => {
    expect(
      mapCsvRow(csvRow({ 'Country Code': code, Currency: 'Dollar($)' })),
    ).toMatchObject({ cost: { currency } });
  });

  it.each([
    ['Bras�_lia', 'Brasília', 'brasilia'],
    ['S��o Paulo', 'São Paulo', 'sao paulo'],
    ['��stanbul', 'İstanbul', 'istanbul'],
  ])('repairs the garbled city %j', (raw, city, normCity) => {
    expect(mapCsvRow(csvRow({ City: raw }))).toMatchObject({
      address: { city },
      norm: { city: normCity },
    });
  });

  it('repairs garbled cuisines', () => {
    expect(
      mapCsvRow(csvRow({ Cuisines: 'D�_ner, B�_rek, Turkish' })),
    ).toMatchObject({
      cuisines: ['Döner', 'Börek', 'Turkish'],
      norm: { cuisines: ['doner', 'borek', 'turkish'] },
    });
  });

  it('replaces the misencoded dotless i in every text field', () => {
    expect(
      mapCsvRow(
        csvRow({
          'Restaurant Name': 'Hattena Hatay Sofras۱',
          Address: 'Osmanl۱ Caddesi, No 41/A',
          Locality: 'Kavakl۱dere',
        }),
      ),
    ).toMatchObject({
      name: 'Hattena Hatay Sofrası',
      address: { line: 'Osmanlı Caddesi, No 41/A', locality: 'Kavaklıdere' },
    });
  });

  it('keeps an unrecoverable name with U+FFFD as it is', () => {
    expect(
      mapCsvRow(csvRow({ 'Restaurant Name': 'Caf� Royal' })),
    ).toMatchObject({ name: 'Caf� Royal' });
  });

  it('collapses whitespace and embedded newlines in text fields', () => {
    expect(
      mapCsvRow(
        csvRow({
          'Restaurant Name': '  Super   Loco ',
          Address: 'Ground Floor,\nCyber Hub',
        }),
      ),
    ).toMatchObject({
      name: 'Super Loco',
      address: { line: 'Ground Floor, Cyber Hub' },
    });
  });

  it('de-duplicates cuisines and maps blank cuisines to []', () => {
    expect(mapCsvRow(csvRow({ Cuisines: 'Cafe, Bakery, Cafe' }))).toMatchObject(
      { cuisines: ['Cafe', 'Bakery'] },
    );
    expect(mapCsvRow(csvRow({ Cuisines: '' }))).toMatchObject({
      cuisines: [],
      norm: { cuisines: [] },
    });
  });

  it('resolves city aliases into norm.city only', () => {
    expect(mapCsvRow(csvRow({ City: 'Gurugram' }))).toMatchObject({
      address: { city: 'Gurugram' },
      norm: { city: 'gurgaon' },
    });
  });

  it('maps Yes/No flags to booleans', () => {
    expect(
      mapCsvRow(
        csvRow({
          'Has Table booking': 'Yes',
          'Has Online delivery': 'No',
          'Is delivering now': 'Yes',
        }),
      ),
    ).toMatchObject({
      features: {
        tableBooking: true,
        onlineDelivery: false,
        deliveringNow: true,
      },
    });
  });

  it('drops the columns ADR-001 does not keep', () => {
    const json = JSON.stringify(mapCsvRow(csvRow()));

    for (const dropped of ['Yellow', 'Good', 'Sector 29, Gurgaon', 'Rupees']) {
      expect(json).not.toContain(dropped);
    }
  });

  it('throws when a column is missing', () => {
    const row = csvRow();
    delete row['Votes'];

    expect(() => mapCsvRow(row)).toThrow('CSV row has no "Votes" column');
  });
});

describe('mapCsvRows', () => {
  it('separates restaurants from skipped rows', () => {
    const { restaurants, skips } = mapCsvRows([
      csvRow(),
      csvRow({ 'Restaurant ID': '18419884' }),
    ]);

    expect(restaurants.map((r) => r.sourceId)).toEqual([308322]);
    expect(skips).toEqual([
      { skip: true, sourceId: 18419884, reason: 'test row' },
    ]);
  });
});
