"use strict";
// Historical cache only. FRED never refreshes the official trading snapshot or its success timestamps.
const D = require("../macro-data.js"),
  { requestJSON } = require("./http.cjs");
const mapping = {
  ccpi_m: "CPILFESL",
  ccpi_y: "CPILFENS",
  cpi_m: "CPIAUCSL",
  cpi_y: "CPIAUCNS",
  cppi_m: "WPSFD49104",
  ppi_m: "WPSFD4",
};
function validateHistory(data, now = Date.now()) {
  D.requireCondition(
    data?.schemaVersion === 1 &&
      data.notForTrading === true &&
      Array.isArray(data.series) &&
      Object.keys(data).every((k) =>
        ["schemaVersion", "notForTrading", "fetchedAt", "series"].includes(k),
      ),
    "Invalid historical cache",
  );
  if (data.fetchedAt !== null)
    D.requireCondition(D.timestamp(data.fetchedAt) <= now, "Future history");
  D.requireCondition(
    data.series.length === 0 || data.fetchedAt !== null,
    "History needs fetch metadata",
  );
  const seriesSeen = new Set();
  for (const s of data.series) {
    D.requireCondition(
      !seriesSeen.has(s.series),
      "Duplicate historical series",
    );
    seriesSeen.add(s.series);
    D.requireCondition(
      Object.keys(s).every((k) =>
        [
          "indicator",
          "series",
          "source",
          "adjustment",
          "asOfDate",
          "releaseCalendarDate",
          "publicationDate",
          "observations",
        ].includes(k),
      ) && s.publicationDate === null,
      "Unexpected history fields",
    );
    D.requireCondition(
      mapping[s.indicator] === s.series &&
        s.source === "FRED" &&
        s.adjustment === D.definitions[s.indicator].adjustment &&
        Array.isArray(s.observations),
      "Wrong historical mapping",
    );
    D.requireCondition(
      /^\d{4}-\d{2}-\d{2}$/.test(s.asOfDate) &&
        D.timestamp(s.asOfDate + "T00:00:00Z") <= D.timestamp(data.fetchedAt),
      "Invalid vintage",
    );
    D.requireCondition(
      /^\d{4}-\d{2}-\d{2}$/.test(s.releaseCalendarDate) &&
        D.timestamp(s.releaseCalendarDate + "T00:00:00Z") <=
          D.timestamp(s.asOfDate + "T00:00:00Z"),
      "Unreleased historical data",
    );
    const seen = new Set();
    for (const o of s.observations) {
      D.requireCondition(
        Object.keys(o).every((k) =>
          ["period", "value", "revisionStatus"].includes(k),
        ),
        "Unexpected history observation fields",
      );
      D.requireCondition(
        D.period(o.period) <
          D.timestamp(s.asOfDate + "T00:00:00Z") - 45 * 86400000 &&
          !seen.has(o.period),
        "Invalid history observation",
      );
      seen.add(o.period);
      D.rate(o.value, o.value);
      D.requireCondition(
        ["first-seen", "unchanged", "revised"].includes(o.revisionStatus),
        "Missing historical revision status",
      );
    }
  }
  return data;
}
function normalize(id, meta, releases, payload, old, now, lagDays) {
  const d = D.definitions[id];
  D.requireCondition(
    Number.isInteger(lagDays) && lagDays >= 45,
    "Historical lag must be at least 45 days",
  );
  const m = meta?.seriess?.[0];
  D.requireCondition(
    meta.seriess.length === 1 &&
      m.id === mapping[id] &&
      m.frequency === "Monthly" &&
      m.seasonal_adjustment ===
        (d.adjustment === "SA"
          ? "Seasonally Adjusted"
          : "Not Seasonally Adjusted"),
    "Mismatched FRED series metadata",
  );
  const asOfDate = new Date(now).toISOString().slice(0, 10),
    cutoff = new Date(now - lagDays * 86400000).toISOString().slice(0, 7);
  const dates = releases?.release_dates;
  D.requireCondition(Array.isArray(dates), "Missing FRED release dates");
  const released = dates
    .filter((x) => x.date <= asOfDate)
    .map((x) => x.date)
    .sort()
    .at(-1);
  D.requireCondition(released, "No published FRED release");
  D.requireCondition(
    payload?.realtime_start === asOfDate &&
      payload.realtime_end === asOfDate &&
      payload.units === "lin" &&
      Array.isArray(payload.observations) &&
      payload.count === payload.observations.length,
    "Invalid/truncated FRED vintage",
  );
  const prior = new Map(
    (old?.observations || []).map((o) => [o.period, o.value]),
  );
  const observations = [];
  for (const x of payload.observations) {
    D.requireCondition(
      /^\d{4}-\d{2}-01$/.test(x.date) &&
        x.date.slice(0, 7) < cutoff &&
        x.realtime_start === asOfDate &&
        x.realtime_end === asOfDate,
      "Historical period/vintage lag mismatch",
    );
    if (x.value === ".") continue;
    D.rate(x.value, x.value);
    const p = x.date.slice(0, 7);
    observations.push({
      period: p,
      value: x.value,
      revisionStatus: prior.has(p)
        ? prior.get(p) === x.value
          ? "unchanged"
          : "revised"
        : "first-seen",
    });
  }
  D.requireCondition(observations.length > 0, "No historical values");
  return {
    indicator: id,
    series: mapping[id],
    source: "FRED",
    adjustment: d.adjustment,
    asOfDate,
    releaseCalendarDate: released,
    publicationDate: null,
    observations,
  };
}
async function collect({
  key,
  now = Date.now(),
  fetcher = fetch,
  minimumLagDays = 45,
  previous = {
    schemaVersion: 1,
    notForTrading: true,
    fetchedAt: null,
    series: [],
  },
} = {}) {
  D.requireCondition(
    typeof key === "string" && key.trim(),
    "FRED_API_KEY is required",
  );
  const call = async (endpoint, params) => {
    const url = new URL("https://api.stlouisfed.org/fred/" + endpoint);
    for (const [k, v] of Object.entries({
      ...params,
      api_key: key,
      file_type: "json",
    }))
      url.searchParams.set(k, String(v));
    return requestJSON(url, {}, fetcher);
  };
  const date = new Date(now).toISOString().slice(0, 10),
    end = new Date(now - minimumLagDays * 86400000);
  end.setUTCDate(0);
  const series = [];
  for (const [id, s] of Object.entries(mapping)) {
    const meta = await call("series", { series_id: s });
    const release = await call("series/release", { series_id: s });
    const r = release?.releases?.[0];
    D.requireCondition(
      r &&
        r.name ===
          (D.definitions[id].family === "cpi"
            ? "Consumer Price Index"
            : "Producer Price Index"),
      "Wrong FRED release family",
    );
    const releases = await call("release/dates", {
      release_id: r.id,
      include_release_dates_with_no_data: false,
      sort_order: "desc",
      limit: 10,
    });
    const observations = await call("series/observations", {
      series_id: s,
      realtime_start: date,
      realtime_end: date,
      observation_start: `${new Date(now).getUTCFullYear() - 2}-01-01`,
      observation_end: end.toISOString().slice(0, 10),
      units: "lin",
      limit: 1000,
    });
    series.push(
      normalize(
        id,
        meta,
        releases,
        observations,
        previous.series.find((x) => x.indicator === id),
        now,
        minimumLagDays,
      ),
    );
  }
  const data = {
    schemaVersion: 1,
    notForTrading: true,
    fetchedAt: new Date(now).toISOString(),
    series,
  };
  return validateHistory(data, now);
}
module.exports = { mapping, normalize, collect, validateHistory };
