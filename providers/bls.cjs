"use strict";
const D = require("../macro-data.js"),
  { requestJSON } = require("./http.cjs"),
  { record } = require("./common.cjs");
const series = Object.values(D.definitions)
  .filter((d) => d.host === "bls.gov")
  .map((d) => d.series);
function parseResponse(response, now = Date.now()) {
  D.requireCondition(
    response?.status === "REQUEST_SUCCEEDED" &&
      Array.isArray(response.Results?.series),
    "BLS API error",
  );
  const result = {};
  for (const s of response.Results.series) {
    D.requireCondition(
      series.includes(s.seriesID) &&
        !result[s.seriesID] &&
        Array.isArray(s.data),
      "Wrong/duplicate BLS series",
    );
    const rows = new Map();
    for (const x of s.data) {
      if (x.period === "M13") continue;
      D.requireCondition(
        /^M(?:0[1-9]|1[0-2])$/.test(x.period) && /^\d{4}$/.test(x.year),
        "Invalid BLS monthly period",
      );
      const p = x.year + "-" + x.period.slice(1);
      D.requireCondition(
        D.period(p) <= now && !rows.has(p),
        "Future/duplicate BLS observation",
      );
      if (
        x.value === "-" ||
        x.value === "." ||
        x.value === null ||
        x.value === ""
      )
        rows.set(p, { period: p, value: null, preliminary: false });
      else {
        D.rate(x.value, x.value);
        rows.set(p, {
          period: p,
          value: x.value,
          preliminary: (x.footnotes || []).some((f) => f.code === "P"),
        });
      }
    }
    result[s.seriesID] = rows;
  }
  return result;
}
function familyRecords(parsed, family, now, manifest = {}) {
  const ids = Object.keys(D.definitions).filter(
      (id) => D.definitions[id].family === family,
    ),
    latest = [];
  for (const id of ids) {
    const rows = parsed[D.definitions[id].series];
    D.requireCondition(rows?.size, "Missing series");
    latest.push([...rows.keys()].sort().at(-1));
  }
  D.requireCondition(
    new Set(latest).size === 1,
    "Mismatched BLS release periods",
  );
  const obs = latest[0],
    records = {};
  for (const id of ids) {
    const d = D.definitions[id],
      rows = parsed[d.series],
      prior = D.shiftMonth(obs, -1);
    const periods = [
      obs,
      D.shiftMonth(obs, -d.lag),
      prior,
      D.shiftMonth(prior, -d.lag),
    ];
    const unique = [...new Set(periods)];
    const inputs = unique.map((p) => {
      const x = rows.get(p);
      D.requireCondition(
        x && x.value !== null,
        "Incomplete published index history",
      );
      return x;
    });
    // Monthly rates share t-1 in actual/previous evidence; pad-free canonical unique inputs.
    const c = {
      method: "index-percent-change",
      series: d.series,
      adjustment: d.adjustment,
      inputUnit: "index",
      outputDecimals: 1,
      lagMonths: d.lag,
      inputs,
    };
    records[id] = record(
      id,
      obs,
      D.rate(rows.get(obs).value, rows.get(periods[1]).value),
      D.rate(rows.get(prior).value, rows.get(periods[3]).value),
      c,
      now,
      manifest,
    );
  }
  return records;
}
async function collect({
  key,
  now = Date.now(),
  fetcher = fetch,
  manifest = {},
} = {}) {
  const year = new Date(now).getUTCFullYear();
  const body = {
    seriesid: series,
    startyear: String(year - 2),
    endyear: String(year),
  };
  if (key) body.registrationkey = key;
  const response = await requestJSON(
    "https://api.bls.gov/publicAPI/" +
      (key ? "v2" : "v1") +
      "/timeseries/data/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    fetcher,
  );
  const parsed = parseResponse(response, now);
  return { parsed, now, manifest };
}
module.exports = { series, parseResponse, familyRecords, collect };
