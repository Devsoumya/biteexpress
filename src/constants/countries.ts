import type { Country } from '../models/country.model';

// Supported markets. The seed codes were mapped from the cities under each
// code in the CSV; currency comes from here, never from the CSV's Currency
// column (it calls code 162, the Philippines, "Botswana Pula").
export const COUNTRIES: readonly Country[] = [
  { seedCode: 1, isoCode: 'IN', name: 'India', currency: 'INR' },
  { seedCode: 14, isoCode: 'AU', name: 'Australia', currency: 'AUD' },
  { seedCode: 30, isoCode: 'BR', name: 'Brazil', currency: 'BRL' },
  { seedCode: 37, isoCode: 'CA', name: 'Canada', currency: 'CAD' },
  { seedCode: 94, isoCode: 'ID', name: 'Indonesia', currency: 'IDR' },
  { seedCode: 148, isoCode: 'NZ', name: 'New Zealand', currency: 'NZD' },
  { seedCode: 162, isoCode: 'PH', name: 'Philippines', currency: 'PHP' },
  { seedCode: 166, isoCode: 'QA', name: 'Qatar', currency: 'QAR' },
  { seedCode: 184, isoCode: 'SG', name: 'Singapore', currency: 'SGD' },
  { seedCode: 189, isoCode: 'ZA', name: 'South Africa', currency: 'ZAR' },
  { seedCode: 191, isoCode: 'LK', name: 'Sri Lanka', currency: 'LKR' },
  { seedCode: 208, isoCode: 'TR', name: 'Türkiye', currency: 'TRY' },
  {
    seedCode: 214,
    isoCode: 'AE',
    name: 'United Arab Emirates',
    currency: 'AED',
  },
  { seedCode: 215, isoCode: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { seedCode: 216, isoCode: 'US', name: 'United States', currency: 'USD' },
];
