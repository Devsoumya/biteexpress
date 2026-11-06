import {
  roundCoordinates,
  summarizeCriteria,
} from '../../../src/utils/log-safety';

describe('log safety', () => {
  it.each([
    [
      { lat: 28.49512, lng: 77.08931 },
      { lat: 28.5, lng: 77.09 },
    ],
    [
      { lat: -33.86882, lng: 151.20929 },
      { lat: -33.87, lng: 151.21 },
    ],
  ])('rounds coordinates to 2 decimals', (input, output) => {
    expect(roundCoordinates(input)).toEqual(output);
  });

  it('lists filter names, never values', () => {
    const summary = summarizeCriteria(
      {
        cuisineMatch: 'all',
        city: 'gurgaon',
        cuisines: ['cafe'],
        maxCost: 500,
        currency: 'INR',
        sort: 'cost',
        order: 'desc',
        radiusKm: 3,
        origin: { lat: 1.234, lng: 5.678 },
      },
      20,
    );

    expect(summary).toEqual({
      sort: 'cost',
      order: 'desc',
      filters: ['city', 'cuisines', 'currency', 'maxCost'],
      origin: { lat: 1.23, lng: 5.68 },
      radiusKm: 3,
      limit: 20,
    });
    expect(JSON.stringify(summary)).not.toMatch(/gurgaon|cafe|INR|500/);
  });
});
