import { decodeUtf8Strict, parseCsvRecords } from '../../../src/utils/csv';

describe('parseCsvRecords', () => {
  it('maps each row to an object keyed by the header', () => {
    expect(parseCsvRecords('id,name\n1,Cafe\n2,Bakery\n')).toEqual([
      { id: '1', name: 'Cafe' },
      { id: '2', name: 'Bakery' },
    ]);
  });

  it.each([
    [
      'a comma inside quotes',
      'id,address\n1,"Shop 12, Sector 29"\n',
      'Shop 12, Sector 29',
    ],
    [
      'an escaped quote',
      'id,address\n1,"Ada ""e"" Haandi\'s"\n',
      'Ada "e" Haandi\'s',
    ],
    [
      'a newline inside quotes',
      'id,address\n1,"Line one\nLine two"\n',
      'Line one\nLine two',
    ],
    ['an empty field', 'id,address\n1,\n', ''],
    [
      'surrounding spaces (kept for the mapper)',
      'id,address\n1,  Noida \n',
      '  Noida ',
    ],
  ])('keeps %s', (_case, text, expected) => {
    expect(parseCsvRecords(text)).toEqual([{ id: '1', address: expected }]);
  });

  it('accepts CRLF line endings', () => {
    expect(parseCsvRecords('id,name\r\n1,Cafe\r\n')).toEqual([
      { id: '1', name: 'Cafe' },
    ]);
  });

  it('adds no record for a trailing newline or blank lines', () => {
    expect(parseCsvRecords('id,name\n1,Cafe\n\n\n')).toHaveLength(1);
  });

  it('strips a byte-order mark from the first header', () => {
    expect(parseCsvRecords('﻿id,name\n1,Cafe\n')).toEqual([
      { id: '1', name: 'Cafe' },
    ]);
  });

  it.each([
    ['too few fields', 'id,name,city\n1,Cafe\n'],
    ['too many fields', 'id,name\n1,Cafe,Extra\n'],
    ['a stray quote', 'id,name\n1,Ca"fe\n'],
    ['an unclosed quote', 'id,name\n1,"Cafe\n'],
  ])('throws on %s', (_case, text) => {
    expect(() => parseCsvRecords(text)).toThrow();
  });
});

describe('decodeUtf8Strict', () => {
  it('decodes UTF-8, including replacement characters', () => {
    const bytes = new TextEncoder().encode('São �');

    expect(decodeUtf8Strict(bytes)).toBe('São �');
  });

  it('throws on bytes that are not UTF-8 (for example a latin1 file)', () => {
    const latin1SaoPaulo = Uint8Array.from([0x53, 0xe3, 0x6f]); // "São" in latin1

    expect(() => decodeUtf8Strict(latin1SaoPaulo)).toThrow();
  });
});
