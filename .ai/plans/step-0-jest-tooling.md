# Step 0: Tooling (Vitest → Jest)

- **Status:** Done
- **Design:** ADR-005 (Configuration; Moving the scaffold from Vitest); `AGENTS.md` §4 (commands), §8 (testing)

## Goal

Swap the test runner from Vitest to Jest + ts-jest, keeping Supertest. Set up two Jest projects, `unit` and `integration`, with the npm scripts that later steps use. The suite must stay green with no database: one ported health test and one real unit test.

## Approach

Implementation order (each step leaves the repo runnable):

1. **Dependencies** (ask first; network): `npm uninstall vitest`, then `npm install -D jest@^30 ts-jest@^29.4 @types/jest@^30`. `package-lock.json` updates.
2. **`tsconfig.test.json`** (new):

   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "rootDir": ".",
       "noEmit": true,
       "types": ["node", "jest"]
     },
     "include": ["src/**/*.ts", "tests/**/*.ts"]
   }
   ```

   The base `tsconfig.json` is unchanged, so `npm run build` still emits only `src` to `dist/`.

3. **`jest.config.js`** (new, CommonJS). A shared `base` object is spread into both projects:
   - `testEnvironment: 'node'`
   - `transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }] }`
   - `collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/server.ts']`

   Projects:
   - `unit`: `testMatch: ['<rootDir>/tests/unit/**/*.test.ts']`
   - `integration`: `testMatch: ['<rootDir>/tests/integration/**/*.test.ts']`, `testTimeout: 20000`. **No `globalSetup`/`globalTeardown` yet** (see Decisions).

   Top level: `coverageDirectory: 'coverage'`, `coverageReporters: ['text', 'lcov']`.

4. **Scripts** in `package.json`:
   - `"test": "jest --runInBand"`
   - `"test:unit": "jest --selectProjects unit"`
   - `"test:integration": "jest --selectProjects integration --runInBand"`
   - `"test:coverage": "jest --runInBand --coverage"`
   - `"typecheck": "tsc --noEmit -p tsconfig.test.json"` (now covers `tests/` too)

   `lint`, `format` and `format:check` are unchanged.

5. **Port the health test** in `tests/integration/health.api.test.ts`: drop the `vitest` import (Jest globals) and drop the `../setup/test-environment` import. It keeps `import { app } from '../../src/app'`, because the `createApp(deps)` refactor belongs to Step 1.
6. **Delete `tests/setup/test-environment.ts`.** Jest sets `NODE_ENV=test` itself, so the file has no job left. `tests/setup/` returns in Step 1 with `global-setup.ts`.
7. **First unit test**: `tests/unit/config/env.test.ts` against the existing `loadEnv()` in `src/config/env.ts`. It proves the `unit` project is wired and avoids `--passWithNoTests`, which would hide a broken `testMatch`.
8. **ESLint** (`eslint.config.js`): add `coverage/**` to `ignores`. Add a block `{ files: ['tests/**/*.ts'], languageOptions: { globals: globals.jest } }`.
9. **Docs**: README Commands table (the four test scripts; "Tests import the Express app directly…" stays true). Add an "AI usage" section with the Step 0 line. In `.ai/BUILD-PLAN.md`, tick the boxes and update Status. Fill in "Notes after implementation" here.

## Decisions and trade-offs

- **No `globalSetup` in Step 0.** ADR-005's setup needs MongoDB, the validator and the search index definition (Step 3), and later the fixtures (Step 5). Adding it now would break the health test, which must run with no DB. It is added in steps: Step 1 (connect, ping, drop `biteexpress_test`), Step 3 (validator, unique index, search index), Step 5 (fixtures, `waitForSearch`).
- **Explicit `transform` instead of `preset: 'ts-jest'`.** The preset reads `tsconfig.json`, whose `rootDir: "src"` rejects test files. Pointing ts-jest at `tsconfig.test.json` is the conventional fix. ADR-005 has a note on this.
- **ts-jest (type-checking) rather than `@swc/jest`**, as ADR-005 decided. The suite is small, so speed is not a concern.
- **`npm test` = one `jest --runInBand` over both projects**, rather than `test:unit && test:integration`. This gives one coverage report and one exit code. Unit tests are fast, so serializing them costs nothing.
- **`typecheck` uses `tsconfig.test.json`**, so test files are type-checked outside Jest too. Side effect: Jest globals are visible to `src` during typecheck only. `npm run build` (base config) would still reject them.
- **`app` singleton kept** in Step 0, so this step changes no behavior.
- **Versions:** jest 30 / ts-jest 29.4 / @types/jest 30, the current majors (checked 2026-11-05: 30.5.2 / 29.4.15 / 30.0.0). ts-jest 29.4 declares jest 30 support.

## Tests

- [x] `tests/integration/health.api.test.ts` (ported): `GET /health` → 200 `{ status: 'ok' }` with no MongoDB connection
- [x] `tests/unit/config/env.test.ts`:
  - [x] applies defaults (`PORT` 3000, `NODE_ENV` development) when only `MONGODB_URI` is set
  - [x] coerces `PORT` from a string
  - [x] rejects a missing `MONGODB_URI`
  - [x] rejects a non-MongoDB URI (`http://…`)
  - [x] rejects an out-of-range `PORT`

**Verification** (all with no MongoDB running):

```sh
npm run test:unit          # 1 suite, 5 tests, unit project only
npm run test:integration   # health test passes
npm test                   # both projects
npm run test:coverage      # report printed, coverage/ written
npm run lint && npm run typecheck && npm run format:check
npm run build && ls dist   # no tests/ in dist; build unaffected
grep -r vitest package.json package-lock.json tests src   # no matches
```

**Acceptance:** all of the above pass, `vitest` is gone from `package.json` and the lockfile, and no test needs a database.

## Out of scope

- `globalSetup`/`globalTeardown`, `TEST_MONGODB_URI`, fixtures, `waitForSearch` (Steps 1, 3, 5)
- `createApp(deps)` refactor (Step 1)
- Docker `test` stage and service (Step 1)
- Coverage thresholds (later, once there is code worth thresholding)

## Notes after implementation

> Paths changed after this step: the code moved to top-level layer folders (`change-layered-structure.md`). For example, `src/modules/health/*` is now `controllers/`, `services/`, `repositories/` and `models/`, `src/middleware/` is `src/middlewares/`, and the tests moved under `tests/unit/{services,routes}` and `tests/integration/{repositories,routes}`.

Implemented on 2026-11-05. Installed `jest@30.5.2`, `ts-jest@29.4.15` and `@types/jest@30.0.0`; removed `vitest`.

Results (no MongoDB running):

| Command                    | Result                                                                     |
| -------------------------- | -------------------------------------------------------------------------- |
| `npm run test:unit`        | 1 suite, 5 tests passed                                                    |
| `npm run test:integration` | 1 suite, 1 test passed (health)                                            |
| `npm test`                 | 2 suites, 6 tests passed in 2 projects                                     |
| `npm run test:coverage`    | passed; `coverage/` written (lines 63.9%; error handler not yet exercised) |
| `npm run lint`             | passed                                                                     |
| `npm run typecheck`        | passed (now includes `tests/`)                                             |
| `npm run format:check`     | passed                                                                     |
| `npm run build`            | passed; `dist/` holds only `src` output                                    |
| `grep -r vitest …`         | no matches in `package.json`, `package-lock.json`, `tests/`, `src/`        |

Differences from the plan:

- **ts-jest warning TS151002** ("hybrid module kind … only supported in `isolatedModules: true`") appeared on every file. Setting `isolatedModules` makes ts-jest transpile-only, which would drop the type checking this plan chose. The package is CommonJS only, so the mixed ESM/CJS case the warning covers cannot occur here. The warning is therefore ignored with `diagnostics: { ignoreCodes: [151002] }`, with a comment in `jest.config.js`. Checked: a test with a deliberate type error still fails under Jest (TS2322). If a later ts-jest major makes this an error, the fallback is `isolatedModules: true` in `tsconfig.test.json`; type errors in tests would then be caught by `npm run typecheck` only.
- `tests/setup/` was removed along with `test-environment.ts`, because it was empty afterwards. Step 1 recreates it.
- npm warned that install scripts for `esbuild`, `fsevents` and `@parcel/watcher` were not run (npm's install-script policy). `tsx` still runs (`npx tsx -e …` checked), so nothing was approved.
