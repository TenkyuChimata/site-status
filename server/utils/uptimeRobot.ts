import dayjs, { type Dayjs } from "dayjs";

export const RANGES_TIMEOUT_MS = 15_000;
export const LOGS_TIMEOUT_MS = 10_000;

export interface UptimeRobotLog {
  type: number;
  datetime: number;
  duration: number;
}

export interface UptimeRobotMonitor {
  id: number;
  friendly_name?: string;
  url?: string;
  status?: number;
  type?: number;
  interval?: number;
  custom_uptime_ranges?: string;
  logs?: UptimeRobotLog[];
}

export interface UptimeRobotResponse {
  stat: "ok";
  monitors: UptimeRobotMonitor[];
}

export interface UptimeRanges {
  dates: Dayjs[];
  start: number;
  end: number;
  ranges: string;
  count: number;
}

export interface UptimeRobotFetchOptions {
  method: "POST";
  body: Record<string, string | number>;
  timeout: number;
  retry: 0;
}

export type UptimeRobotFetcher = (
  url: string,
  options: UptimeRobotFetchOptions,
) => Promise<unknown>;

export class UptimeRobotRefreshError extends Error {
  readonly components: readonly ("ranges" | "logs")[];

  constructor(components: readonly ("ranges" | "logs")[]) {
    super(`UptimeRobot refresh failed: ${components.join(", ")}`);
    this.name = "UptimeRobotRefreshError";
    this.components = components;
  }
}

export class MonitorSetMismatchError extends Error {
  constructor() {
    super("UptimeRobot monitor sets do not match");
    this.name = "MonitorSetMismatchError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const readOptionalString = (
  value: Record<string, unknown>,
  key: string,
): string | undefined =>
  typeof value[key] === "string" ? value[key] : undefined;

const readOptionalNumber = (
  value: Record<string, unknown>,
  key: string,
): number | undefined => (isFiniteNumber(value[key]) ? value[key] : undefined);

const parseBaseMonitor = (value: unknown): UptimeRobotMonitor => {
  if (!isRecord(value) || !isFiniteNumber(value.id)) {
    throw new Error("Invalid UptimeRobot monitor");
  }
  return {
    id: value.id,
    friendly_name: readOptionalString(value, "friendly_name"),
    url: readOptionalString(value, "url"),
    status: readOptionalNumber(value, "status"),
    type: readOptionalNumber(value, "type"),
    interval: readOptionalNumber(value, "interval"),
  };
};

const parseRangesResponse = (value: unknown): UptimeRobotResponse => {
  if (
    !isRecord(value) ||
    value.stat !== "ok" ||
    !Array.isArray(value.monitors)
  ) {
    throw new Error("Invalid UptimeRobot ranges response");
  }
  return {
    stat: "ok",
    monitors: value.monitors.map((item) => {
      const monitor = parseBaseMonitor(item);
      if (!isRecord(item) || typeof item.custom_uptime_ranges !== "string") {
        throw new Error("Missing UptimeRobot uptime ranges");
      }
      return {
        ...monitor,
        custom_uptime_ranges: item.custom_uptime_ranges,
      };
    }),
  };
};

const parseLogsResponse = (value: unknown): UptimeRobotResponse => {
  if (
    !isRecord(value) ||
    value.stat !== "ok" ||
    !Array.isArray(value.monitors)
  ) {
    throw new Error("Invalid UptimeRobot logs response");
  }
  return {
    stat: "ok",
    monitors: value.monitors.map((item) => {
      const monitor = parseBaseMonitor(item);
      if (!isRecord(item) || !Array.isArray(item.logs)) {
        throw new Error("Missing UptimeRobot logs");
      }
      const logs = item.logs.map((log): UptimeRobotLog => {
        if (
          !isRecord(log) ||
          !isFiniteNumber(log.type) ||
          !isFiniteNumber(log.datetime)
        ) {
          throw new Error("Invalid UptimeRobot log");
        }
        return {
          type: log.type,
          datetime: log.datetime,
          duration: isFiniteNumber(log.duration) ? log.duration : 0,
        };
      });
      return { ...monitor, logs };
    }),
  };
};

export const buildRanges = (
  days: number,
  now: Dayjs = dayjs(),
): UptimeRanges => {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("COUNT_DAYS must be a positive integer");
  }
  const today = now.startOf("day");
  const dates = Array.from({ length: days }, (_, index) =>
    today.subtract(index, "day"),
  );
  const rangeList = dates.map(
    (date) => `${date.unix()}_${date.add(1, "day").unix()}`,
  );
  const oldestDate = dates.at(-1);
  const newestDate = dates[0];
  if (!oldestDate || !newestDate) {
    throw new Error("COUNT_DAYS produced no ranges");
  }
  const start = oldestDate.unix();
  const end = newestDate.add(1, "day").unix();
  rangeList.push(`${start}_${end}`);
  return {
    dates,
    start,
    end,
    ranges: rangeList.join("-"),
    count: rangeList.length,
  };
};

const getEndpoint = (apiUrl: string) =>
  `${apiUrl.replace(/\/+$/, "")}/getMonitors`;

export const fetchRanges = async (
  fetcher: UptimeRobotFetcher,
  apiUrl: string,
  apiKey: string,
  rangeData: UptimeRanges,
): Promise<UptimeRobotResponse> =>
  parseRangesResponse(
    await fetcher(getEndpoint(apiUrl), {
      method: "POST",
      body: {
        api_key: apiKey,
        format: "json",
        custom_uptime_ranges: rangeData.ranges,
      },
      timeout: RANGES_TIMEOUT_MS,
      retry: 0,
    }),
  );

export const fetchLogs = async (
  fetcher: UptimeRobotFetcher,
  apiUrl: string,
  apiKey: string,
  rangeData: UptimeRanges,
): Promise<UptimeRobotResponse> =>
  parseLogsResponse(
    await fetcher(getEndpoint(apiUrl), {
      method: "POST",
      body: {
        api_key: apiKey,
        format: "json",
        logs: 1,
        log_types: "1-2",
        logs_start_date: rangeData.start,
        logs_end_date: rangeData.end,
      },
      timeout: LOGS_TIMEOUT_MS,
      retry: 0,
    }),
  );

const toMonitorMap = (monitors: UptimeRobotMonitor[]) => {
  const map = new Map<number, UptimeRobotMonitor>();
  for (const monitor of monitors) {
    if (map.has(monitor.id)) throw new MonitorSetMismatchError();
    map.set(monitor.id, monitor);
  }
  return map;
};

export const mergeMonitorResponses = (
  rangesResponse: UptimeRobotResponse,
  logsResponse: UptimeRobotResponse,
): UptimeRobotResponse => {
  const logsById = toMonitorMap(logsResponse.monitors);
  const rangeIds = new Set(rangesResponse.monitors.map(({ id }) => id));
  if (
    rangeIds.size !== rangesResponse.monitors.length ||
    logsById.size !== rangeIds.size ||
    [...logsById.keys()].some((id) => !rangeIds.has(id))
  ) {
    throw new MonitorSetMismatchError();
  }
  return {
    stat: "ok",
    monitors: rangesResponse.monitors.map((rangeMonitor) => {
      const logMonitor = logsById.get(rangeMonitor.id);
      if (!logMonitor?.logs) throw new MonitorSetMismatchError();
      // Ranges are authoritative for monitor metadata and ordering.
      return { ...rangeMonitor, logs: logMonitor.logs };
    }),
  };
};

export const refreshUptimeRobot = async (options: {
  fetcher: UptimeRobotFetcher;
  apiUrl: string;
  apiKey: string;
  countDays: number;
  now?: Dayjs;
}): Promise<{ response: UptimeRobotResponse; ranges: UptimeRanges }> => {
  const ranges = buildRanges(options.countDays, options.now);
  const [rangesResult, logsResult] = await Promise.allSettled([
    fetchRanges(options.fetcher, options.apiUrl, options.apiKey, ranges),
    fetchLogs(options.fetcher, options.apiUrl, options.apiKey, ranges),
  ]);
  if (rangesResult.status === "rejected" || logsResult.status === "rejected") {
    const failures: ("ranges" | "logs")[] = [];
    if (rangesResult.status === "rejected") failures.push("ranges");
    if (logsResult.status === "rejected") failures.push("logs");
    throw new UptimeRobotRefreshError(failures);
  }
  return {
    response: mergeMonitorResponses(rangesResult.value, logsResult.value),
    ranges,
  };
};
