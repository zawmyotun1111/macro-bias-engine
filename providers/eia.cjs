"use strict";
const D = require("../macro-data.js"),
  { requestJSON } = require("./http.cjs"),
  { record } = require("./common.cjs");
function normalize(response, now = Date.now(), manifest = {}) {
  const body = response?.response;
  D.requireCondition(
    body &&
      body.frequency === "weekly" &&
      Array.isArray(body.data) &&
      body.data.length >= 3 &&
      body.data.length <= 10,
    "Incomplete EIA stock history",
  );
  const rows = body.data
    .map((x) => {
      D.requireCondition(
        x.series === "WCESTUS1" &&
          x.product === "EPC0" &&
          x.process === "SAX" &&
          x.duoarea === "NUS" &&
          x.units === "MBBL",
        "Wrong oil geography/product/stock definition/units",
      );
      D.requireCondition(
        D.period(x.period, true) <= now,
        "Future inventory period",
      );
      D.oilChange(x.value, x.value);
      return { period: x.period, value: String(x.value), preliminary: false };
    })
    .sort((a, b) => b.period.localeCompare(a.period));
  D.requireCondition(
    new Set(rows.map((x) => x.period)).size === rows.length,
    "Duplicate stock weeks",
  );
  const inputs = rows.slice(0, 3);
  const r = record(
    "oil",
    inputs[0].period,
    D.oilChange(inputs[0].value, inputs[1].value),
    D.oilChange(inputs[1].value, inputs[2].value),
    {
      method: "weekly-stock-difference",
      series: "WCESTUS1",
      adjustment: "NSA",
      inputUnit: "thousand barrels",
      inputs,
    },
    now,
    manifest,
  );
  D.validateRecord(r, "oil", now);
  return r;
}
async function collect({
  key,
  now = Date.now(),
  fetcher = fetch,
  manifest = {},
} = {}) {
  D.requireCondition(
    typeof key === "string" && key.trim(),
    "EIA_API_KEY is required",
  );
  const url = new URL("https://api.eia.gov/v2/petroleum/stoc/wstk/data/");
  for (const [k, v] of Object.entries({
    api_key: key,
    frequency: "weekly",
    "data[0]": "value",
    "facets[series][]": "WCESTUS1",
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    offset: "0",
    length: "10",
  }))
    url.searchParams.set(k, v);
  return normalize(await requestJSON(url, {}, fetcher), now, manifest);
}
module.exports = { normalize, collect };
