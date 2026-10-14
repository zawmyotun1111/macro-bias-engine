"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  D = require("../macro-data.js"),
  BLS = require("../providers/bls.cjs"),
  EIA = require("../providers/eia.cjs"),
  FRED = require("../providers/fred.cjs"),
  { revision } = require("../providers/common.cjs");
function configValid(c) {
  D.requireCondition(
    c &&
      Object.keys(c).every((k) => ["bls", "eia", "fred"].includes(k)) &&
      ["bls", "eia", "fred"].every((k) => typeof c[k]?.enabled === "boolean"),
    "Invalid provider configuration",
  );
  D.requireCondition(
    Number.isInteger(c.fred.minimumLagDays) && c.fred.minimumLagDays >= 45,
    "Unsafe FRED lag",
  );
  for (const provider of ["bls", "eia", "fred"])
    D.requireCondition(
      Object.keys(c[provider]).every((key) =>
        (provider === "fred"
          ? ["enabled", "minimumLagDays"]
          : ["enabled"]
        ).includes(key),
      ),
      "Credentials belong only in Actions Secrets",
    );
  return c;
}
async function collectAll({
  config,
  previous = D.emptySnapshot(),
  history = {
    schemaVersion: 1,
    notForTrading: true,
    fetchedAt: null,
    series: [],
  },
  manifest = {},
  keys = {},
  fetcher = fetch,
  now = Date.now(),
} = {}) {
  configValid(config);
  D.validateSnapshot(previous, now);
  FRED.validateHistory(history, now);
  const snapshot = structuredClone(previous),
    warnings = [];
  let refreshed = 0,
    blsOk = false,
    historical = null;
  function merge(records) {
    const prepared = {};
    for (const [id, r] of Object.entries(records)) {
      revision(r, previous.indicators[id]);
      D.validateRecord(r, id, now);
      prepared[id] = r;
    }
    Object.assign(snapshot.indicators, prepared);
    refreshed += Object.keys(prepared).length;
  }
  if (config.bls.enabled)
    try {
      const result = await BLS.collect({
        key: keys.bls,
        fetcher,
        now,
        manifest,
      });
      for (const family of ["cpi", "ppi"])
        try {
          merge(BLS.familyRecords(result.parsed, family, now, manifest));
          blsOk = true;
        } catch {
          warnings.push(
            family +
              ": incomplete/mismatched/invalid release; retained verified values",
          );
        }
    } catch {
      warnings.push("BLS request failed; retained verified values");
    }
  if (config.eia.enabled)
    try {
      merge({
        oil: await EIA.collect({ key: keys.eia, fetcher, now, manifest }),
      });
    } catch {
      warnings.push("EIA request/validation failed; retained verified values");
    }
  if (config.fred.enabled && !blsOk)
    try {
      historical = await FRED.collect({
        key: keys.fred,
        fetcher,
        now,
        minimumLagDays: config.fred.minimumLagDays,
        previous: history,
      });
    } catch {
      warnings.push(
        "FRED historical fallback failed; retained historical cache",
      );
    }
  // No collector accesses ISM or fills consensus forecasts.
  if (refreshed) {
    snapshot.generatedAt = new Date(now).toISOString();
    D.validateSnapshot(snapshot, now);
  }
  D.requireCondition(
    refreshed > 0 || historical !== null,
    "No configured provider passed validation; files unchanged",
  );
  return { snapshot, refreshed, historical, warnings };
}
async function atomic(file, value, keys) {
  const data = JSON.stringify(value, null, 2) + "\n";
  D.requireCondition(
    Object.values(keys)
      .filter(Boolean)
      .every((key) => !data.includes(key)),
    "Credential detected; publication stopped",
  );
  await fs.writeFile(file + ".tmp", data);
  await fs.rename(file + ".tmp", file);
}
async function main() {
  const root = path.join(__dirname, ".."),
    read = async (p) =>
      JSON.parse(await fs.readFile(path.join(root, p), "utf8"));
  const keys = {
    bls: process.env.BLS_API_KEY,
    eia: process.env.EIA_API_KEY,
    fred: process.env.FRED_API_KEY,
  };
  const result = await collectAll({
    config: await read("config/providers.json"),
    manifest: await read("config/publications.json"),
    previous: await read("data/economic-data.json"),
    history: await read("data/historical-data.json"),
    keys,
  });
  if (result.refreshed)
    await atomic(
      path.join(root, "data/economic-data.json"),
      result.snapshot,
      keys,
    );
  if (result.historical)
    await atomic(
      path.join(root, "data/historical-data.json"),
      result.historical,
      keys,
    );
  console.log(
    `Verified ${result.refreshed}/7 automated indicator fields. ISM and forecasts require manual entry.`,
  );
  result.warnings.forEach((w) => console.warn(w));
}
if (require.main === module)
  main().catch(() => {
    console.error(
      "Collection failed; no successful output. Check sanitized provider diagnostics, configuration and API secrets.",
    );
    process.exitCode = 1;
  });
module.exports = { collectAll, configValid, atomic };
