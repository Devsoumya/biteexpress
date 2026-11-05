// The base tsconfig.json has rootDir "src", which rejects test files, so
// ts-jest is pointed at tsconfig.test.json explicitly instead of the preset.
//
// TS151002 warns that module NodeNext is only fully supported with
// isolatedModules. Setting isolatedModules would switch ts-jest to
// transpile-only (no type checks in tests). This package is CommonJS only, so
// the mixed ESM/CJS case the warning is about does not arise; ignore it.
const base = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
};

module.exports = {
  // Coverage options are global in Jest; inside `projects` they are ignored.
  collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/server.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      testTimeout: 20000,
      globalSetup: '<rootDir>/tests/setup/global-setup.ts',
      globalTeardown: '<rootDir>/tests/setup/global-teardown.ts',
    },
  ],
};
