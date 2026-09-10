// https://uptimerobot.com/api/#methods
import type { MonitorsResult } from "~~/types/main";
import { formatSiteData } from "~/utils/format";
import {
  createUnavailableMonitorsResult,
  resolveMonitorRequest,
} from "../utils/monitorService";
import {
  deleteL1StatusCache,
  getL1StatusCache,
  getStatusCacheKey,
  getStatusCacheStore,
  readL2StatusCache,
  setL1StatusCache,
  writeL2StatusCache,
} from "../utils/statusCache";
import { refreshUptimeRobot } from "../utils/uptimeRobot";

const getErrorName = (error: unknown) =>
  error instanceof Error ? error.name : "UnknownError";

export default defineEventHandler(async (event): Promise<MonitorsResult> => {
  try {
    const config = useRuntimeConfig();
    const { apiUrl, apiKey, sitePassword, siteSecretKey } = config;
    if (!apiUrl || !apiKey) {
      throw new Error("Missing API configuration");
    }
    if (sitePassword && siteSecretKey) {
      const token = getCookie(event, "authToken");
      if (!token) throw new Error("MissingAuthToken");
      if (!(await verifyJwt(token))) throw new Error("InvalidAuthToken");
    }

    const countDays = Number(config.public.countDays);
    const showLink = Boolean(config.public.showLink);
    const cacheKey = getStatusCacheKey(countDays, showLink);
    const cacheStore = getStatusCacheStore(event.context.cloudflare?.env);

    return await resolveMonitorRequest({
      refreshKey: cacheKey,
      now: Date.now,
      readL1: () => getL1StatusCache(cacheKey),
      writeL1: (record) => setL1StatusCache(cacheKey, record),
      deleteL1: () => {
        deleteL1StatusCache(cacheKey);
      },
      readL2: cacheStore
        ? () => readL2StatusCache(cacheStore, cacheKey, countDays)
        : undefined,
      writeL2: cacheStore
        ? (record) => writeL2StatusCache(cacheStore, cacheKey, record)
        : undefined,
      refresh: async () => {
        const snapshot = await refreshUptimeRobot({
          fetcher: (url, options) => $fetch(url, options),
          apiUrl,
          apiKey,
          countDays,
        });
        const data = formatSiteData(snapshot.response, snapshot.ranges.dates, {
          showLink,
        });
        if (!data) throw new Error("InvalidFormattedMonitorData");
        return data;
      },
      waitUntil: (promise) => event.waitUntil(promise),
      logError: (operation, error) => {
        console.error(
          JSON.stringify({
            message: "monitor cache operation failed",
            operation,
            error: getErrorName(error),
          }),
        );
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "monitor data unavailable",
        error: getErrorName(error),
      }),
    );
    setResponseStatus(event, 503);
    return createUnavailableMonitorsResult();
  }
});
