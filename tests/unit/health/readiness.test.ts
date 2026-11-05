import {
  createReadinessCheck,
  type ProbedIndexState,
  type ReadinessProbes,
} from '../../../src/modules/health/readiness';

function fakeProbes(overrides: Partial<ReadinessProbes> = {}) {
  return {
    ping: jest.fn(overrides.ping ?? (() => Promise.resolve())),
    searchIndexState: jest.fn(
      overrides.searchIndexState ??
        (() => Promise.resolve<ProbedIndexState>('ok')),
    ),
  };
}

describe('createReadinessCheck', () => {
  it('is ready when the ping succeeds and the index is queryable', async () => {
    const check = createReadinessCheck(fakeProbes());

    await expect(check()).resolves.toEqual({
      ready: true,
      checks: { mongo: 'ok', searchIndex: 'ok' },
    });
  });

  it('skips the index check when the ping fails', async () => {
    const probes = fakeProbes({
      ping: () => Promise.reject(new Error('down')),
    });
    const check = createReadinessCheck(probes);

    await expect(check()).resolves.toEqual({
      ready: false,
      checks: { mongo: 'fail', searchIndex: 'skipped' },
    });
    expect(probes.searchIndexState).not.toHaveBeenCalled();
  });

  it.each(['missing', 'not_queryable'] as const)(
    'is not ready when the index is %s',
    async (state) => {
      const check = createReadinessCheck(
        fakeProbes({ searchIndexState: () => Promise.resolve(state) }),
      );

      await expect(check()).resolves.toEqual({
        ready: false,
        checks: { mongo: 'ok', searchIndex: state },
      });
    },
  );

  it('reports error when the index probe throws', async () => {
    const check = createReadinessCheck(
      fakeProbes({
        searchIndexState: () => Promise.reject(new Error('mongot down')),
      }),
    );

    await expect(check()).resolves.toEqual({
      ready: false,
      checks: { mongo: 'ok', searchIndex: 'error' },
    });
  });

  it('returns the cached result within the TTL without probing again', async () => {
    let time = 0;
    const probes = fakeProbes();
    const check = createReadinessCheck(probes, { now: () => time });

    await check();
    time = 4999;
    await check();

    expect(probes.ping).toHaveBeenCalledTimes(1);
  });

  it('probes again once the TTL has passed', async () => {
    let time = 0;
    const probes = fakeProbes({
      searchIndexState: () => Promise.resolve('missing'),
    });
    const check = createReadinessCheck(probes, { now: () => time });

    await check();
    probes.searchIndexState.mockResolvedValue('ok');
    time = 5000;

    await expect(check()).resolves.toMatchObject({ ready: true });
    expect(probes.ping).toHaveBeenCalledTimes(2);
  });
});
