import type { MonitorsDataResult, MonitorsResult } from "../../types/main";
import {
  createStatusCacheRecord,
  getStatusCacheAge,
  getStatusCacheState,
  type StatusCacheRecord,
} from "./statusCache";

export interface MonitorServiceDependencies {
  refreshKey: string;
  now: () => number;
  readL1: () => StatusCacheRecord | undefined;
  writeL1: (record: StatusCacheRecord) => void;
  deleteL1: () => void;
  readL2?: () => Promise<StatusCacheRecord | undefined>;
  writeL2?: (record: StatusCacheRecord) => Promise<void>;
  refresh: () => Promise<MonitorsDataResult>;
  waitUntil: (promise: Promise<unknown>) => void;
  logError?: (operation: string, error: unknown) => void;
  freshnessMs?: number;
  retentionMs?: number;
}

const refreshPromises = new Map<string, Promise<StatusCacheRecord>>();

const toResult = (
  record: StatusCacheRecord,
  cache: "l1" | "kv" | null,
  stale: boolean,
  now: number,
): MonitorsResult => ({
  code: 200,
  message: "success",
  source: cache === null ? "api" : "cache",
  cache,
  stale,
  age: Math.floor(getStatusCacheAge(record, now) / 1000),
  data: record.data,
});

const refreshAndCache = async (
  dependencies: MonitorServiceDependencies,
): Promise<StatusCacheRecord> => {
  const data = await dependencies.refresh();
  const record = createStatusCacheRecord(data);
  dependencies.writeL1(record);
  if (dependencies.writeL2) {
    try {
      await dependencies.writeL2(record);
    } catch (error) {
      dependencies.logError?.("kv-write", error);
    }
  }
  return record;
};

const getOrCreateRefresh = (dependencies: MonitorServiceDependencies) => {
  const activePromise = refreshPromises.get(dependencies.refreshKey);
  if (activePromise) return { promise: activePromise, started: false };
  const trackedPromise = refreshAndCache(dependencies).finally(() => {
    if (refreshPromises.get(dependencies.refreshKey) === trackedPromise) {
      refreshPromises.delete(dependencies.refreshKey);
    }
  });
  refreshPromises.set(dependencies.refreshKey, trackedPromise);
  return { promise: trackedPromise, started: true };
};

const scheduleRefresh = (dependencies: MonitorServiceDependencies) => {
  const refresh = getOrCreateRefresh(dependencies);
  if (!refresh.started) return;
  dependencies.waitUntil(
    refresh.promise.catch((error) => {
      dependencies.logError?.("background-refresh", error);
    }),
  );
};

const getState = (
  record: StatusCacheRecord,
  dependencies: MonitorServiceDependencies,
) =>
  getStatusCacheState(
    record,
    dependencies.now(),
    dependencies.freshnessMs,
    dependencies.retentionMs,
  );

export const resolveMonitorRequest = async (
  dependencies: MonitorServiceDependencies,
): Promise<MonitorsResult> => {
  const l1Record = dependencies.readL1();
  if (l1Record) {
    const state = getState(l1Record, dependencies);
    if (state === "fresh") {
      return toResult(l1Record, "l1", false, dependencies.now());
    }
    if (state === "stale") {
      scheduleRefresh(dependencies);
      return toResult(l1Record, "l1", true, dependencies.now());
    }
    dependencies.deleteL1();
  }

  if (dependencies.readL2) {
    try {
      const l2Record = await dependencies.readL2();
      if (l2Record) {
        const state = getState(l2Record, dependencies);
        if (state !== "expired") {
          dependencies.writeL1(l2Record);
          if (state === "stale") scheduleRefresh(dependencies);
          return toResult(
            l2Record,
            "kv",
            state === "stale",
            dependencies.now(),
          );
        }
      }
    } catch (error) {
      dependencies.logError?.("kv-read", error);
    }
  }

  const refresh = getOrCreateRefresh(dependencies);
  const record = await refresh.promise;
  return toResult(record, null, false, dependencies.now());
};

export const createUnavailableMonitorsResult = (): MonitorsResult => ({
  code: 503,
  message: "Monitor data is temporarily unavailable",
  source: "api",
  cache: null,
  stale: false,
  age: 0,
  data: undefined,
});

export const resetMonitorRefreshState = () => {
  refreshPromises.clear();
};
