(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MacroData = api;
})(globalThis, function () {
  "use strict";
  const definitions = {
    ccpi_m: {
      name: "Core CPI m/m",
      unit: "%",
      host: "bls.gov",
      maxAgeDays: 45,
      range: [-20, 20],
      series: "CUSR0000SA0L1E",
      adjustment: "SA",
      lag: 1,
      family: "cpi",
    },
    ccpi_y: {
      name: "Core CPI y/y",
      unit: "%",
      host: "bls.gov",
      maxAgeDays: 45,
      range: [-30, 100],
      series: "CUUR0000SA0L1E",
      adjustment: "NSA",
      lag: 12,
      family: "cpi",
    },
    cpi_m: {
      name: "CPI m/m",
      unit: "%",
      host: "bls.gov",
      maxAgeDays: 45,
      range: [-20, 20],
      series: "CUSR0000SA0",
      adjustment: "SA",
      lag: 1,
      family: "cpi",
    },
    cpi_y: {
      name: "CPI y/y",
      unit: "%",
      host: "bls.gov",
      maxAgeDays: 45,
      range: [-30, 100],
      series: "CUUR0000SA0",
      adjustment: "NSA",
      lag: 12,
      family: "cpi",
    },
    cppi_m: {
      name: "Core PPI m/m (less foods/energy)",
      unit: "%",
      host: "bls.gov",
      maxAgeDays: 45,
      range: [-20, 20],
      series: "WPSFD49104",
      adjustment: "SA",
      lag: 1,
      family: "ppi",
    },
    ppi_m: {
      name: "PPI final demand m/m",
      unit: "%",
      host: "bls.gov",
      maxAgeDays: 45,
      range: [-20, 20],
      series: "WPSFD4",
      adjustment: "SA",
      lag: 1,
      family: "ppi",
    },
    ism: {
      name: "ISM Services PMI",
      unit: "index",
      host: "ismworld.org",
      maxAgeDays: 40,
      range: [0, 100],
    },
    prices: {
      name: "ISM Services Prices Paid",
      unit: "index",
      host: "ismworld.org",
      maxAgeDays: 40,
      range: [0, 100],
    },
    employment: {
      name: "ISM Services Employment",
      unit: "index",
      host: "ismworld.org",
      maxAgeDays: 40,
      range: [0, 100],
    },
    oil: {
      name: "EIA commercial crude change (excluding SPR)",
      unit: "million barrels",
      host: "eia.gov",
      maxAgeDays: 10,
      range: [-100, 100],
      series: "WCESTUS1",
      adjustment: "NSA",
      family: "oil",
    },
  };
  function requireCondition(v, m) {
    if (!v) throw Error(m);
  }
  function timestamp(v) {
    requireCondition(
      typeof v === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v),
      "Invalid UTC timestamp",
    );
    const t = Date.parse(v);
    requireCondition(
      Number.isFinite(t) &&
        new Date(t).toISOString().slice(0, 19) === v.slice(0, 19),
      "Invalid date",
    );
    return t;
  }
  function officialURL(v, host) {
    const u = new URL(v);
    requireCondition(
      ["https:", "http:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (u.hostname === host || u.hostname.endsWith("." + host)),
      "Untrusted source URL",
    );
    u.protocol = "https:";
    return u.href;
  }
  function numeric(v, d) {
    if (
      v === null ||
      v === undefined ||
      (typeof v === "string" && v.trim() === "")
    )
      return null;
    requireCondition(
      typeof v === "number" &&
        Number.isFinite(v) &&
        v >= d.range[0] &&
        v <= d.range[1],
      "Invalid numeric value",
    );
    return v;
  }
  function period(v, weekly = false) {
    requireCondition(
      typeof v === "string" &&
        (weekly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(v),
      "Invalid observation period",
    );
    const t = timestamp(v + (weekly ? "" : "-01") + "T00:00:00Z");
    if (weekly)
      requireCondition(
        new Date(t).getUTCDay() === 5,
        "Inventory period must be Friday",
      );
    return t;
  }
  function shiftMonth(v, n) {
    period(v);
    const [y, m] = v.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  }
  // Integer arithmetic preserves published decimal levels and rounds half away from zero.
  function scaled(v) {
    requireCondition(
      typeof v === "string" && /^\d+(?:\.\d{1,6})?$/.test(v),
      "Invalid index level",
    );
    const [a, b = ""] = v.split(".");
    const x = BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
    requireCondition(x > 0n, "Index denominator/level must be positive");
    return x;
  }
  function rate(current, base) {
    const a = scaled(current),
      b = scaled(base),
      n = (a - b) * 1000n;
    const abs = n < 0n ? -n : n;
    const q = abs / b + ((abs % b) * 2n >= b ? 1n : 0n);
    return Number(n < 0n ? -q : q) / 10;
  }
  function oilChange(a, b) {
    requireCondition(
      /^\d+$/.test(String(a)) && /^\d+$/.test(String(b)),
      "Invalid stock level",
    );
    const x = Number(a),
      y = Number(b);
    requireCondition(
      Number.isSafeInteger(x) && Number.isSafeInteger(y) && x > 0 && y > 0,
      "Invalid stock level",
    );
    return (x - y) / 1000;
  }
  function emptyRecord(id) {
    return {
      actual: null,
      forecast: null,
      previous: null,
      forecastKind: null,
      unit: definitions[id].unit,
      status: "unavailable",
      observationPeriod: null,
      publicationDate: null,
      publicationStatus: "unknown",
      fetchedAt: null,
      lastSuccessfulUpdate: null,
      source: null,
      collectionMethod: null,
      revision: null,
      calculation: null,
    };
  }
  function emptySnapshot() {
    return {
      schemaVersion: 2,
      generatedAt: null,
      indicators: Object.fromEntries(
        Object.keys(definitions).map((id) => [id, emptyRecord(id)]),
      ),
    };
  }
  function validateRecord(r, id, now = Date.now()) {
    const d = definitions[id];
    requireCondition(d && r && typeof r === "object", "Unknown indicator");
    requireCondition(
      Object.keys(r).every((k) => Object.keys(emptyRecord(id)).includes(k)),
      "Unexpected record field",
    );
    requireCondition(
      r.unit === d.unit && ["released", "unavailable"].includes(r.status),
      "Invalid status/unit",
    );
    for (const f of ["actual", "forecast", "previous"]) {
      requireCondition(
        r[f] === null || typeof r[f] === "number",
        "Use null for missing",
      );
      numeric(r[f], d);
    }
    // No automated consensus feed is configured. Forecasts are session-only overlays.
    requireCondition(
      r.forecast === null && r.forecastKind === null,
      "Official snapshot cannot contain consensus forecasts",
    );
    if (r.status === "unavailable") {
      requireCondition(
        Object.entries(emptyRecord(id)).every(
          ([key, value]) => r[key] === value,
        ),
        "Unavailable record must be blank",
      );
      return r;
    }
    requireCondition(r.actual !== null, "Missing actual");
    const obs = period(r.observationPeriod, id === "oil"),
      fetchTime = timestamp(r.fetchedAt),
      success = timestamp(r.lastSuccessfulUpdate);
    requireCondition(
      (id === "oil" ||
        period(shiftMonth(r.observationPeriod, 1)) <= fetchTime) &&
        obs <= fetchTime &&
        fetchTime <= now &&
        success === fetchTime,
      "Inconsistent observation/fetch/check dates",
    );
    requireCondition(
      ["unknown", "confirmed"].includes(r.publicationStatus),
      "Invalid publication status",
    );
    if (r.publicationDate === null)
      requireCondition(
        r.publicationStatus === "unknown",
        "Missing confirmed publication",
      );
    else
      requireCondition(
        r.publicationStatus === "confirmed" &&
          timestamp(r.publicationDate) >= obs &&
          timestamp(r.publicationDate) <= fetchTime,
        "Invalid publication date",
      );
    requireCondition(
      r.source &&
        Object.keys(r.source).every((k) =>
          ["name", "url", "provider", "series"].includes(k),
        ) &&
        typeof r.source.name === "string" &&
        r.source.name.length > 0 &&
        r.source.name.length < 160,
      "Missing source",
    );
    const manual = ["ism", "prices", "employment"].includes(id);
    requireCondition(
      r.source.provider ===
        (manual ? "Manual verification" : id === "oil" ? "EIA" : "BLS"),
      "Wrong official provider",
    );
    officialURL(r.source.url, d.host);
    requireCondition(
      r.source.series === (d.series || null),
      "Incorrect source series",
    );
    requireCondition(
      r.collectionMethod === (manual ? "manual-verified" : "official-api"),
      "Invalid collection method",
    );
    requireCondition(
      r.revision &&
        Object.keys(r.revision).every((k) =>
          ["status", "detectedAt"].includes(k),
        ) &&
        ["first-seen", "unchanged", "revised", "unknown"].includes(
          r.revision.status,
        ) &&
        r.revision.detectedAt !== undefined,
      "Missing revision status",
    );
    if (r.revision.detectedAt !== null)
      requireCondition(
        timestamp(r.revision.detectedAt) <= fetchTime,
        "Future revision",
      );
    if (manual) {
      requireCondition(
        r.publicationDate !== null && r.calculation === null,
        "Verified manual release requires publication/source",
      );
      return r;
    }
    const c = r.calculation;
    requireCondition(
      c &&
        Object.keys(c).every((k) =>
          [
            "method",
            "series",
            "adjustment",
            "inputUnit",
            "outputDecimals",
            "lagMonths",
            "inputs",
          ].includes(k),
        ) &&
        c.series === d.series &&
        c.adjustment === d.adjustment &&
        Array.isArray(c.inputs),
      "Wrong calculation/source mapping",
    );
    requireCondition(
      c.inputs.every(
        (x) =>
          x &&
          Object.keys(x).every((k) =>
            ["period", "value", "preliminary"].includes(k),
          ) &&
          typeof x.preliminary === "boolean",
      ),
      "Invalid raw evidence",
    );
    const values = new Map();
    for (const x of c.inputs) {
      period(x.period, id === "oil");
      requireCondition(!values.has(x.period), "Duplicate evidence");
      values.set(x.period, x.value);
    }
    if (id === "oil") {
      requireCondition(
        c.method === "weekly-stock-difference" &&
          c.inputUnit === "thousand barrels" &&
          c.inputs.length === 3,
        "Incorrect oil definition/units",
      );
      const week = (n) =>
        new Date(obs + n * 7 * 86400000).toISOString().slice(0, 10);
      requireCondition(
        values.has(week(-1)) && values.has(week(-2)),
        "Noncomparable stock weeks",
      );
      requireCondition(
        r.actual ===
          oilChange(values.get(r.observationPeriod), values.get(week(-1))) &&
          r.previous === oilChange(values.get(week(-1)), values.get(week(-2))),
        "Oil calculation mismatch",
      );
    } else {
      requireCondition(
        c.method === "index-percent-change" &&
          c.inputUnit === "index" &&
          c.outputDecimals === 1 &&
          c.lagMonths === d.lag &&
          c.inputs.length === (d.lag === 1 ? 3 : 4),
        "Invalid inflation method",
      );
      const base = shiftMonth(r.observationPeriod, -d.lag),
        prior = shiftMonth(r.observationPeriod, -1),
        priorBase = shiftMonth(prior, -d.lag);
      requireCondition(
        r.actual === rate(values.get(r.observationPeriod), values.get(base)) &&
          r.previous === rate(values.get(prior), values.get(priorBase)),
        "Inflation calculation mismatch",
      );
    }
    return r;
  }
  function validateSnapshot(s, now = Date.now()) {
    requireCondition(
      s &&
        s.schemaVersion === 2 &&
        s.indicators &&
        Object.keys(s.indicators).length === 10 &&
        Object.keys(s).every((k) =>
          ["schemaVersion", "generatedAt", "indicators"].includes(k),
        ),
      "Invalid snapshot",
    );
    if (s.generatedAt !== null)
      requireCondition(timestamp(s.generatedAt) <= now, "Future snapshot");
    for (const id of Object.keys(definitions)) {
      const r = validateRecord(s.indicators[id], id, now);
      if (r.lastSuccessfulUpdate)
        requireCondition(
          s.generatedAt !== null &&
            timestamp(r.lastSuccessfulUpdate) <= timestamp(s.generatedAt),
          "Snapshot predates check",
        );
    }
    return s;
  }
  function freshness(r, id, now = Date.now()) {
    if (r.status !== "released") return "unavailable";
    const d = definitions[id],
      obs = period(r.observationPeriod, id === "oil");
    const cadence = id === "oil" ? 14 : 75;
    if (
      now - timestamp(r.lastSuccessfulUpdate) > 36 * 3600000 ||
      now - obs > cadence * 86400000 ||
      (r.publicationDate &&
        now - timestamp(r.publicationDate) > d.maxAgeDays * 86400000)
    )
      return "stale";
    return "fresh";
  }
  return {
    definitions,
    requireCondition,
    timestamp,
    officialURL,
    numeric,
    period,
    shiftMonth,
    rate,
    oilChange,
    emptyRecord,
    emptySnapshot,
    validateRecord,
    validateSnapshot,
    freshness,
  };
});
