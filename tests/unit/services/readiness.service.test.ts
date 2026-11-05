import type {
  HealthRepository,
  ProbedIndexState,
} from '../../../src/models/health.model';
import { CachedReadinessService } from '../../../src/services/readiness.service';

function fakeRepository(overrides: Partial<HealthRepository> = {}) {
  return {
    ping: jest.fn(overrides.ping ?? (() => Promise.resolve())),
    searchIndexState: jest.fn(
      overrides.searchIndexState ??
        (() => Promise.resolve<ProbedIndexState>('ok')),
    ),
  };
}

describe('CachedReadinessService', () => {
  it('is ready when the ping succeeds and the index is queryable', async () => {
    const service = new CachedReadinessService(fakeRepository());

    await expect(service.check()).resolves.toEqual({
      ready: true,
      checks: { mongo: 'ok', searchIndex: 'ok' },
    });
  });

  it('skips the index check when the ping fails', async () => {
    const repository = fakeRepository({
      ping: () => Promise.reject(new Error('down')),
    });
    const service = new CachedReadinessService(repository);

    await expect(service.check()).resolves.toEqual({
      ready: false,
      checks: { mongo: 'fail', searchIndex: 'skipped' },
    });
    expect(repository.searchIndexState).not.toHaveBeenCalled();
  });

  it.each(['missing', 'not_queryable'] as const)(
    'is not ready when the index is %s',
    async (state) => {
      const service = new CachedReadinessService(
        fakeRepository({ searchIndexState: () => Promise.resolve(state) }),
      );

      await expect(service.check()).resolves.toEqual({
        ready: false,
        checks: { mongo: 'ok', searchIndex: state },
      });
    },
  );

  it('reports error when the index check throws', async () => {
    const service = new CachedReadinessService(
      fakeRepository({
        searchIndexState: () => Promise.reject(new Error('mongot down')),
      }),
    );

    await expect(service.check()).resolves.toEqual({
      ready: false,
      checks: { mongo: 'ok', searchIndex: 'error' },
    });
  });

  it('returns the cached result within the TTL without checking again', async () => {
    let time = 0;
    const repository = fakeRepository();
    const service = new CachedReadinessService(repository, {
      now: () => time,
    });

    await service.check();
    time = 4999;
    await service.check();

    expect(repository.ping).toHaveBeenCalledTimes(1);
  });

  it('checks again once the TTL has passed', async () => {
    let time = 0;
    const repository = fakeRepository({
      searchIndexState: () => Promise.resolve('missing'),
    });
    const service = new CachedReadinessService(repository, {
      now: () => time,
    });

    await service.check();
    repository.searchIndexState.mockResolvedValue('ok');
    time = 5000;

    await expect(service.check()).resolves.toMatchObject({ ready: true });
    expect(repository.ping).toHaveBeenCalledTimes(2);
  });
});
