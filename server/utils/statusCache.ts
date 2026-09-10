import { LRUCache } from "lru-cache";
import type { MonitorsDataResult } from "../../types/main";

export const STATUS_CACHE_VERSION = 1 as const;
export const STATUS_CACHE_FRESHNESS_MS = 10 * 60 * 1000;
export const STATUS_CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface StatusCacheRecord {
  version: typeof STATUS_CACHE_VERSION;
  data: MonitorsDataResult;
}

export interface StatusCacheStore {
  get(key: string, type: "json"): Promise<unknown | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export type StatusCacheState = "fresh" | "stale" | "expired";

const l1Cache = new LRUCache<string, StatusCacheRecord>({
  max: 10,
  ttl: STATUS_CACHE_RETENTION_MS,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isDownSummary = (value: unknown) =>
  isRecord(value) &&
  isFiniteNumber(value.times) &&
  isFiniteNumber(value.duration);

const isSiteData = (value: unknown, expectedDays: number) =>
  isRecord(value) &&
  isFiniteNumber(value.id) &&
  typeof value.name === "string" &&
  isFiniteNumber(value.status) &&
  isFiniteNumber(value.type) &&
  isFiniteNumber(value.interval) &&
  isFiniteNumber(value.percent) &&
  isDownSummary(value.down) &&
  Array.isArray(value.days) &&
  value.days.length === expectedDays &&
  value.days.every(
    (day) =>
      isRecord(day) &&
      isFiniteNumber(day.date) &&
      isFiniteNumber(day.percent) &&
      isDownSummary(day.down),
  ) &&
  (value.url === undefined || typeof value.url === "string");

const isMonitorsData = (value: unknown, expectedDays: number) =>
  isRecord(value) &&
  isFiniteNumber(value.timestamp) &&
  isRecord(value.status) &&
  isFiniteNumber(value.status.count) &&
  isFiniteNumber(value.status.ok) &&
  isFiniteNumber(value.status.error) &&
  isFiniteNumber(value.status.unknown) &&
  Array.isArray(value.data) &&
  value.status.count === value.data.length &&
  value.data.every((site) => isSiteData(site, expectedDays));

export const isStatusCacheRecord = (
  value: unknown,
  expectedDays: number,
): value is StatusCacheRecord =>
  isRecord(value) &&
  value.version === STATUS_CACHE_VERSION &&
  isMonitorsData(value.data, expectedDays);

const isStatusCacheStore = (value: unknown): value is StatusCacheStore =>
  isRecord(value) &&
  typeof value.get === "function" &&
  typeof value.put === "function";

export const getStatusCacheStore = (
  env: unknown,
): StatusCacheStore | undefined => {
  if (!isRecord(env)) return undefined;
  const store = env.STATUS_CACHE;
  return isStatusCacheStore(store) ? store : undefined;
};

export const getStatusCacheKey = (countDays: number, showLink: boolean) =>
  `site-status:monitors:v${STATUS_CACHE_VERSION}:${countDays}:${showLink ? "links" : "no-links"}`;

export const createStatusCacheRecord = (
  data: MonitorsDataResult,
): StatusCacheRecord => ({ version: STATUS_CACHE_VERSION, data });

export const getStatusCacheAge = (record: StatusCacheRecord, now: number) =>
  Math.max(0, now - record.data.timestamp);

export const getStatusCacheState = (
  record: StatusCacheRecord,
  now: number,
  freshnessMs = STATUS_CACHE_FRESHNESS_MS,
  retentionMs = STATUS_CACHE_RETENTION_MS,
): StatusCacheState => {
  const age = getStatusCacheAge(record, now);
  if (age <= freshnessMs) return "fresh";
  if (age <= retentionMs) return "stale";
  return "expired";
};

export const getL1StatusCache = (key: string) => l1Cache.get(key);

export const setL1StatusCache = (key: string, record: StatusCacheRecord) => {
  l1Cache.set(key, record, { ttl: STATUS_CACHE_RETENTION_MS });
};

export const deleteL1StatusCache = (key: string) => l1Cache.delete(key);

export const clearL1StatusCache = () => l1Cache.clear();

export const readL2StatusCache = async (
  store: StatusCacheStore,
  key: string,
  expectedDays: number,
): Promise<StatusCacheRecord | undefined> => {
  const value = await store.get(key, "json");
  return isStatusCacheRecord(value, expectedDays) ? value : undefined;
};

export const writeL2StatusCache = (
  store: StatusCacheStore,
  key: string,
  record: StatusCacheRecord,
) =>
  store.put(key, JSON.stringify(record), {
    expirationTtl: Math.ceil(STATUS_CACHE_RETENTION_MS / 1000),
  });
