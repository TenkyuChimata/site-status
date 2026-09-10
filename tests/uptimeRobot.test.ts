import assert from "node:assert/strict";
import test from "node:test";
import dayjs from "dayjs";
import { formatSiteData } from "../app/utils/format";
import {
  LOGS_TIMEOUT_MS,
  MonitorSetMismatchError,
  RANGES_TIMEOUT_MS,
  UptimeRobotRefreshError,
  buildRanges,
  mergeMonitorResponses,
  refreshUptimeRobot,
  type UptimeRobotFetchOptions,
  type UptimeRobotResponse,
} from "../server/utils/uptimeRobot";

const fixedNow = dayjs("2026-09-09T12:00:00+08:00");

const uptimeValues = (days: number, total = "98.75") =>
  [
    ...Array.from({ length: days }, (_, index) =>
      (99.99 - index / 100).toFixed(2),
    ),
    total,
  ].join("-");

const createResponses = (days = 90) => {
  const ranges = buildRanges(days, fixedNow);
  const rangesResponse: UptimeRobotResponse = {
    stat: "ok",
    monitors: [
      {
        id: 1,
        friendly_name: "range-one",
        url: "https://one.example",
        status: 2,
        type: 1,
        interval: 60,
        custom_uptime_ranges: uptimeValues(days),
      },
      {
        id: 2,
        friendly_name: "range-two",
        url: "https://two.example",
        status: 9,
        type: 1,
        interval: 300,
        custom_uptime_ranges: uptimeValues(days, "97.5"),
      },
    ],
  };
  const logsResponse: UptimeRobotResponse = {
    stat: "ok",
    monitors: [
      {
        id: 2,
        friendly_name: "logs-two",
        logs: [
          {
            type: 1,
            datetime: ranges.dates[1].add(1, "hour").unix(),
            duration: 120,
          },
        ],
      },
      {
        id: 1,
        friendly_name: "logs-one",
        logs: [
          {
            type: 1,
            datetime: ranges.dates[0].add(1, "hour").unix(),
            duration: 60,
          },
          {
            type: 2,
            datetime: ranges.dates[0].add(2, "hour").unix(),
            duration: 0,
          },
        ],
      },
    ],
  };
  return { ranges, rangesResponse, logsResponse };
};

test("buildRanges preserves a complete 90-day timeline plus total range", () => {
  const ranges = buildRanges(90, fixedNow);
  const values = ranges.ranges.split("-");

  assert.equal(ranges.dates.length, 90);
  assert.equal(ranges.count, 91);
  assert.equal(values.length, 91);
  values.slice(0, 90).forEach((value, index) => {
    assert.equal(
      value,
      `${ranges.dates[index].unix()}_${ranges.dates[index].add(1, "day").unix()}`,
    );
  });
  assert.equal(values[90], `${ranges.start}_${ranges.end}`);
});

test("refresh splits ranges and logs payloads and merges by monitor ID", async () => {
  const { rangesResponse, logsResponse } = createResponses();
  const requests: UptimeRobotFetchOptions[] = [];

  const result = await refreshUptimeRobot({
    apiUrl: "https://api.uptimerobot.com/v2/",
    apiKey: "test-secret",
    countDays: 90,
    now: fixedNow,
    fetcher: async (_url, options) => {
      requests.push(options);
      return "custom_uptime_ranges" in options.body
        ? rangesResponse
        : logsResponse;
    },
  });

  assert.equal(requests.length, 2);
  const rangesRequest = requests.find(
    ({ body }) => "custom_uptime_ranges" in body,
  );
  const logsRequest = requests.find(({ body }) => "logs" in body);
  assert.ok(rangesRequest);
  assert.ok(logsRequest);
  assert.equal("logs" in rangesRequest.body, false);
  assert.equal("logs_start_date" in rangesRequest.body, false);
  assert.equal("custom_uptime_ranges" in logsRequest.body, false);
  assert.equal(rangesRequest.timeout, RANGES_TIMEOUT_MS);
  assert.equal(logsRequest.timeout, LOGS_TIMEOUT_MS);
  assert.equal(rangesRequest.retry, 0);
  assert.equal(logsRequest.retry, 0);
  assert.deepEqual(
    result.response.monitors.map(({ id }) => id),
    [1, 2],
  );
  assert.equal(result.response.monitors[0].friendly_name, "range-one");
  assert.equal(result.response.monitors[0].logs?.length, 2);
  assert.equal(result.response.monitors[1].logs?.length, 1);
});

test("split responses preserve the previous full-response output at 90 days", () => {
  const { ranges, rangesResponse, logsResponse } = createResponses();
  const merged = mergeMonitorResponses(rangesResponse, logsResponse);
  const logsById = new Map(
    logsResponse.monitors.map((item) => [item.id, item.logs]),
  );
  const previousFullResponse: UptimeRobotResponse = {
    stat: "ok",
    monitors: rangesResponse.monitors.map((monitor) => ({
      ...monitor,
      logs: logsById.get(monitor.id),
    })),
  };
  const options = { showLink: true, timestamp: 1_789_000_000_000 };

  const previous = formatSiteData(previousFullResponse, ranges.dates, options);
  const split = formatSiteData(merged, ranges.dates, options);

  assert.deepEqual(split, previous);
  assert.equal(split?.data[0].days.length, 90);
  assert.equal(split?.data[0].percent, 98.75);
  assert.equal(split?.data[0].days[0].percent, 99.1);
  assert.equal(split?.data[0].days.at(-1)?.percent, 99.99);
  assert.deepEqual(split?.data[0].days.at(-1)?.down, {
    times: 1,
    duration: 60,
  });
  assert.deepEqual(split?.data[1].days.at(-2)?.down, {
    times: 1,
    duration: 120,
  });
  assert.deepEqual(split?.data[0].down, { times: 1, duration: 60 });
  assert.deepEqual(split?.data[1].down, { times: 1, duration: 120 });
});

test("merge rejects missing, extra, or duplicate monitor IDs", () => {
  const { rangesResponse, logsResponse } = createResponses();
  const missing = {
    ...logsResponse,
    monitors: logsResponse.monitors.slice(0, 1),
  };
  const extra = {
    ...logsResponse,
    monitors: [...logsResponse.monitors, { id: 3, logs: [] }],
  };
  const duplicate = {
    ...logsResponse,
    monitors: [...logsResponse.monitors, logsResponse.monitors[0]],
  };

  assert.throws(
    () => mergeMonitorResponses(rangesResponse, missing),
    MonitorSetMismatchError,
  );
  assert.throws(
    () => mergeMonitorResponses(rangesResponse, extra),
    MonitorSetMismatchError,
  );
  assert.throws(
    () => mergeMonitorResponses(rangesResponse, duplicate),
    MonitorSetMismatchError,
  );
});

for (const failedComponent of ["ranges", "logs"] as const) {
  test(`${failedComponent} timeout fails the complete refresh`, async () => {
    const { rangesResponse, logsResponse } = createResponses();

    await assert.rejects(
      refreshUptimeRobot({
        apiUrl: "https://api.uptimerobot.com/v2/",
        apiKey: "test-secret",
        countDays: 90,
        now: fixedNow,
        fetcher: async (_url, options) => {
          const component =
            "custom_uptime_ranges" in options.body ? "ranges" : "logs";
          if (component === failedComponent) throw new Error("AbortError");
          return component === "ranges" ? rangesResponse : logsResponse;
        },
      }),
      (error) =>
        error instanceof UptimeRobotRefreshError &&
        error.components.length === 1 &&
        error.components[0] === failedComponent,
    );
  });
}
