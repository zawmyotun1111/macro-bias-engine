"use strict";
const D = require("../macro-data.js");
function publication(family, period, manifest, now) {
  const entry = manifest[family]?.[period];
  if (!entry) return { publicationDate: null, publicationStatus: "unknown" };
  D.officialURL(entry.sourceURL, family === "oil" ? "eia.gov" : "bls.gov");
  D.requireCondition(
    entry.observationPeriod === period &&
      D.timestamp(entry.publicationDate) <= now,
    "Mismatched/unpublished release metadata",
  );
  return {
    publicationDate: entry.publicationDate,
    publicationStatus: "confirmed",
  };
}
function record(id, obs, actual, previous, calculation, now, manifest = {}) {
  const d = D.definitions[id];
  return {
    ...D.emptyRecord(id),
    actual,
    previous,
    status: "released",
    observationPeriod: obs,
    ...publication(d.family, obs, manifest, now),
    fetchedAt: new Date(now).toISOString(),
    lastSuccessfulUpdate: new Date(now).toISOString(),
    source: {
      name:
        id === "oil"
          ? "US Energy Information Administration (weekly stock estimates)"
          : "US Bureau of Labor Statistics",
      provider: id === "oil" ? "EIA" : "BLS",
      series: d.series,
      url:
        id === "oil"
          ? "https://www.eia.gov/petroleum/supply/weekly/"
          : `https://www.bls.gov/${d.family}/`,
    },
    collectionMethod: "official-api",
    revision: { status: "first-seen", detectedAt: null },
    calculation,
  };
}
function revision(next, old) {
  if (old.status !== "released") return next;
  D.requireCondition(
    next.observationPeriod >= old.observationPeriod,
    "Observation regression",
  );
  let changed = false;
  if (old.calculation && next.calculation) {
    const oldValues = new Map(
      old.calculation.inputs.map((x) => [x.period, x.value]),
    );
    changed = next.calculation.inputs.some(
      (x) =>
        oldValues.has(x.period) &&
        String(oldValues.get(x.period)) !== String(x.value),
    );
  }
  next.revision = {
    status: changed
      ? "revised"
      : next.observationPeriod === old.observationPeriod
        ? "unchanged"
        : "first-seen",
    detectedAt: changed ? next.fetchedAt : old.revision?.detectedAt || null,
  };
  return next;
}
module.exports = { publication, record, revision };
