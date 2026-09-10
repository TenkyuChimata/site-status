import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { MonitorsDataResult } from "../types/main";
import {
  createUnavailableMonitorsResult,
  resetMonitorRefreshState,
  resolveMonitorRequest,
  type MonitorServiceDependencies,
} from "../server/utils/monitorService";
import {
  createStatusCacheRecord,
  getStatusCacheKey,
  getStatusCacheStore,
  isStatusCacheRecord,
  readL2StatusCache,
  type StatusCacheRecord,
  type StatusCacheStore,
} from "../server/utils/statusCache";
import { UptimeRobotRefreshError } from "../server/utils/uptimeRobot";

const NOW = 1_789_000_000_000;
const FRESHNESS_MS = 10 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

const createData = (timestamp: number, days = 90): MonitorsDataResult => ({
  status: { count: 1, ok: 1, error: 0, unknown: 0 },
  data: [
    {
      id: 1,
      name: "example",
      url: "https://example.com",
      status: 2,
      type: 1,
      interval: 60,
      percent: 99.9,
      days: Array.from({ length: days }, (_, index) => ({
        date: 1_780_000_000 + index * 86_400,
        percent: 99.9,
        down: { times: 0, duration: 0 },
      })),
      down: { times: 0, duration: 0 },
    },
  ],
  timestamp,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createDependencies = (
  options: {
    l1?: StatusCacheRecord;
    l2?: StatusCacheRecord;
    refresh?: () => Promise<MonitorsDataResult>;
    l2Unavailable?: boolean;
    l2ReadError?: boolean;
    l2WriteError?: boolean;
  } = {},
) => {
  let l1 = options.l1;
  let l2 = options.l2;
  let refreshCalls = 0;
  const background: Promise<unknown>[] = [];
  const errors: string[] = [];
  const dependencies: MonitorServiceDependencies = {
    refreshKey: "test",
    now: () => NOW,
    readL1: () => l1,
    writeL1: (record) => {
      l1 = record;
    },
    deleteL1: () => {
      l1 = undefined;
    },
    refresh: async () => {
      refreshCalls++;
      return options.refresh ? options.refresh() : createData(NOW);
    },
    waitUntil: (promise) => {
      background.push(promise);
    },
    logError: (operation) => {
      errors.push(operation);
    },
    freshnessMs: FRESHNESS_MS,
    retentionMs: RETENTION_MS,
  };
  if (!options.l2Unavailable) {
    dependencies.readL2 = async () => {
      if (options.l2ReadError) throw new Error("KV read failed");
      return l2;
    };
    dependencies.writeL2 = async (record) => {
      if (options.l2WriteError) throw new Error("KV write failed");
      l2 = record;
    };
  }
  return {
    dependencies,
    background,
    errors,
    getL1: () => l1,
    getL2: () => l2,
    getRefreshCalls: () => refreshCalls,
  };
};

beforeEach(() => {
  resetMonitorRefreshState();
});

test("fresh L1 returns immediately without upstream or KV", async () => {
  const state = createDependencies({
    l1: createStatusCacheRecord(createData(NOW - 1_000)),
  });

  const result = await resolveMonitorRequest(state.dependencies);

  assert.equal(result.source, "cache");
  assert.equal(result.cache, "l1");
  assert.equal(result.stale, false);
  assert.equal(result.age, 1);
  assert.equal(state.getRefreshCalls(), 0);
  assert.equal(state.background.length, 0);
});

test("fresh L2 fills L1 without calling upstream", async () => {
  const l2 = createStatusCacheRecord(createData(NOW - 2_000));
  const state = createDependencies({ l2 });

  const result = await resolveMonitorRequest(state.dependencies);

  assert.equal(result.cache, "kv");
  assert.equal(result.stale, false);
  assert.equal(state.getL1(), l2);
  assert.equal(state.getRefreshCalls(), 0);
});

test("stale cache returns before refresh and updates both caches in background", async () => {
  const next = deferred<MonitorsDataResult>();
  const stale = createStatusCacheRecord(createData(NOW - FRESHNESS_MS - 1_000));
  const state = createDependencies({
    l1: stale,
    refresh: () => next.promise,
  });

  const result = await resolveMonitorRequest(state.dependencies);

  assert.equal(result.cache, "l1");
  assert.equal(result.stale, true);
  assert.equal(state.background.length, 1);
  assert.equal(state.getL1(), stale);
  next.resolve(createData(NOW));
  await state.background[0];
  assert.equal(state.getL1()?.data.timestamp, NOW);
  assert.equal(state.getL2()?.data.timestamp, NOW);
});

for (const failedComponent of ["ranges", "logs"] as const) {
  test(`${failedComponent} background failure preserves the complete stale snapshot`, async () => {
    const stale = createStatusCacheRecord(
      createData(NOW - FRESHNESS_MS - 1_000),
    );
    const state = createDependencies({
      l1: stale,
      refresh: async () => {
        throw new UptimeRobotRefreshError([failedComponent]);
      },
    });

    const result = await resolveMonitorRequest(state.dependencies);
    await state.background[0];

    assert.equal(result.stale, true);
    assert.equal(state.getL1(), stale);
    assert.equal(state.getL2(), undefined);
    assert.deepEqual(state.errors, ["background-refresh"]);
  });
}

test("missing cache initializes with bounded refresh and supports L1-only dev", async () => {
  const state = createDependencies({ l2Unavailable: true });

  const result = await resolveMonitorRequest(state.dependencies);

  assert.equal(result.source, "api");
  assert.equal(result.cache, null);
  assert.equal(result.stale, false);
  assert.equal(state.getRefreshCalls(), 1);
  assert.equal(state.getL1()?.data.timestamp, NOW);
});

test("KV read and write failures gracefully fall back to upstream and L1", async () => {
  const readFailure = createDependencies({ l2ReadError: true });
  const readResult = await resolveMonitorRequest(readFailure.dependencies);

  assert.equal(readResult.source, "api");
  assert.deepEqual(readFailure.errors, ["kv-read"]);

  resetMonitorRefreshState();
  const writeFailure = createDependencies({ l2WriteError: true });
  const writeResult = await resolveMonitorRequest(writeFailure.dependencies);

  assert.equal(writeResult.source, "api");
  assert.equal(writeFailure.getL1()?.data.timestamp, NOW);
  assert.deepEqual(writeFailure.errors, ["kv-write"]);
});

test("same-isolate concurrent cache misses share one refresh", async () => {
  const next = deferred<MonitorsDataResult>();
  const state = createDependencies({
    l2Unavailable: true,
    refresh: () => next.promise,
  });

  const requests = Array.from({ length: 4 }, () =>
    resolveMonitorRequest(state.dependencies),
  );
  assert.equal(state.getRefreshCalls(), 1);
  next.resolve(createData(NOW));
  const results = await Promise.all(requests);

  assert.equal(state.getRefreshCalls(), 1);
  assert.ok(results.every(({ source }) => source === "api"));
});

test("singleflight does not mix snapshots for different cache keys", async () => {
  const firstNext = deferred<MonitorsDataResult>();
  const secondNext = deferred<MonitorsDataResult>();
  const first = createDependencies({
    l2Unavailable: true,
    refresh: () => firstNext.promise,
  });
  const second = createDependencies({
    l2Unavailable: true,
    refresh: () => secondNext.promise,
  });
  first.dependencies.refreshKey = "90:links";
  second.dependencies.refreshKey = "90:no-links";

  const firstRequest = resolveMonitorRequest(first.dependencies);
  const secondRequest = resolveMonitorRequest(second.dependencies);
  assert.equal(first.getRefreshCalls(), 1);
  assert.equal(second.getRefreshCalls(), 1);

  firstNext.resolve(createData(NOW));
  secondNext.resolve(createData(NOW + 1));
  const [firstResult, secondResult] = await Promise.all([
    firstRequest,
    secondRequest,
  ]);

  assert.equal(firstResult.data?.timestamp, NOW);
  assert.equal(secondResult.data?.timestamp, NOW + 1);
});

test("singleflight clears a rejected promise so a later refresh can retry", async () => {
  let shouldFail = true;
  const state = createDependencies({
    l2Unavailable: true,
    refresh: async () => {
      if (shouldFail) throw new Error("timeout");
      return createData(NOW);
    },
  });

  const first = await Promise.allSettled([
    resolveMonitorRequest(state.dependencies),
    resolveMonitorRequest(state.dependencies),
  ]);
  assert.ok(first.every(({ status }) => status === "rejected"));
  assert.equal(state.getRefreshCalls(), 1);

  shouldFail = false;
  const retry = await resolveMonitorRequest(state.dependencies);
  assert.equal(retry.code, 200);
  assert.equal(state.getRefreshCalls(), 2);
});

test("cache schema validates 90 days and resolves an optional KV binding", async () => {
  const record = createStatusCacheRecord(createData(NOW, 90));
  const store: StatusCacheStore = {
    get: async () => record,
    put: async () => {},
  };

  assert.equal(isStatusCacheRecord(record, 90), true);
  assert.equal(isStatusCacheRecord(record, 60), false);
  assert.equal(getStatusCacheStore({ STATUS_CACHE: store }), store);
  assert.equal(getStatusCacheStore({}), undefined);
  assert.equal(getStatusCacheKey(90, true), "site-status:monitors:v1:90:links");
  assert.equal(
    await readL2StatusCache(store, getStatusCacheKey(90, true), 90),
    record,
  );
});

test("controlled unavailable response contains diagnostics but no secret", () => {
  const response = createUnavailableMonitorsResult();
  const serialized = JSON.stringify(response);

  assert.deepEqual(response, {
    code: 503,
    message: "Monitor data is temporarily unavailable",
    source: "api",
    cache: null,
    stale: false,
    age: 0,
    data: undefined,
  });
  assert.equal(serialized.includes("test-secret"), false);
});
