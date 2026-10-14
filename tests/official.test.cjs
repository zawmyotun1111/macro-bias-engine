"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  D = require("../macro-data.js"),
  B = require("../providers/bls.cjs"),
  E = require("../providers/eia.cjs"),
  F = require("../providers/fred.cjs"),
  C = require("../providers/common.cjs"),
  U = require("../scripts/update-data.cjs"),
  H = require("../providers/http.cjs"),
  fixture = require("./fixtures/official.cjs");
const { now } = fixture,
  config = {
    bls: { enabled: true },
    eia: { enabled: true },
    fred: { enabled: false, minimumLagDays: 45 },
  };
const fetcher = async (url) =>
  fixture.response(
    String(url).includes("bls.gov") ? fixture.bls() : fixture.eia(),
  );
function cpi() {
  return B.familyRecords(B.parseResponse(fixture.bls(), now), "cpi", now);
}
function historic() {
  return {
    seriess: [
      {
        id: "CPIAUCSL",
        frequency: "Monthly",
        seasonal_adjustment: "Seasonally Adjusted",
      },
    ],
  };
}
function fredPayload() {
  return {
    realtime_start: "2026-10-14",
    realtime_end: "2026-10-14",
    units: "lin",
    count: 2,
    observations: ["2026-06-01", "2026-07-01"].map((date) => ({
      date,
      value: "300.000",
      realtime_start: "2026-10-14",
      realtime_end: "2026-10-14",
    })),
  };
}
test("MoM uses precise level ratio and one-decimal rounding; ties round away from zero", () => {
  assert.equal(D.rate("100.250", "100.000"), 0.3);
  assert.equal(D.rate("99.750", "100.000"), -0.3);
  assert.equal(D.rate("301.123", "300.000"), 0.4);
  assert.equal(D.rate("100", "100"), 0);
});
test("YoY compares same calendar month one year earlier without annualizing", () => {
  assert.equal(D.rate("312.000", "300.000"), 4);
  assert.equal(D.shiftMonth("2026-01", -12), "2025-01");
  assert.equal(D.shiftMonth("2026-01", -1), "2025-12");
});
test("missing levels, zero denominators, nonfinite and malformed values never become zero", () => {
  for (const x of [
    null,
    undefined,
    "",
    ".",
    "0",
    "-1",
    "1,000",
    "20junk",
    "NaN",
  ])
    assert.throws(() => D.rate("300", x));
});
test("inflation mappings require SA monthly, NSA annual, final-demand PPI and core less foods/energy", () => {
  assert.equal(D.definitions.cpi_m.series, "CUSR0000SA0");
  assert.equal(D.definitions.cpi_y.series, "CUUR0000SA0");
  assert.equal(D.definitions.ccpi_m.series, "CUSR0000SA0L1E");
  assert.equal(D.definitions.ccpi_y.series, "CUUR0000SA0L1E");
  assert.equal(D.definitions.ppi_m.series, "WPSFD4");
  assert.equal(D.definitions.cppi_m.series, "WPSFD49104");
});
test("six BLS rate fields recalculate Previous from prior index levels, never infer Forecast", () => {
  const p = B.parseResponse(fixture.bls(), now);
  for (const family of ["cpi", "ppi"])
    for (const [id, r] of Object.entries(B.familyRecords(p, family, now))) {
      D.validateRecord(r, id, now);
      assert.equal(r.forecast, null);
      assert.equal(r.forecastKind, null);
      assert.equal(r.previous, D.definitions[id].lag === 1 ? -0.3 : -2.9);
    }
});
test("publication timestamp stays blank when API lacks metadata and fetch time is explicit", () => {
  const r = cpi().cpi_m;
  assert.equal(r.publicationDate, null);
  assert.equal(r.publicationStatus, "unknown");
  assert.equal(r.observationPeriod, "2026-09");
  assert.equal(r.fetchedAt, "2026-10-14T18:00:00.000Z");
});
test("official publication manifest requires matching period, source and past timestamp", () => {
  const manifest = {
    cpi: {
      "2026-09": {
        observationPeriod: "2026-09",
        publicationDate: "2026-10-14T12:30:00Z",
        sourceURL: "https://www.bls.gov/news.release/cpi.nr0.htm",
      },
    },
  };
  const r = B.familyRecords(
    B.parseResponse(fixture.bls(), now),
    "cpi",
    now,
    manifest,
  ).cpi_m;
  D.validateRecord(r, "cpi_m", now);
  assert.equal(r.publicationStatus, "confirmed");
  for (const changes of [
    { observationPeriod: "2026-08" },
    { publicationDate: "2026-10-15T12:30:00Z" },
    { sourceURL: "https://bls.gov.evil.example/" },
  ])
    assert.throws(() =>
      B.familyRecords(B.parseResponse(fixture.bls(), now), "cpi", now, {
        cpi: { "2026-09": { ...manifest.cpi["2026-09"], ...changes } },
      }),
    );
});
test("annual average M13 is ignored and monthly duplicates are rejected", () => {
  const p = fixture.bls();
  p.Results.series[0].data.push({ year: "2026", period: "M13", value: "bad" });
  B.parseResponse(p, now);
  p.Results.series[0].data.push(p.Results.series[0].data[0]);
  assert.throws(() => B.parseResponse(p, now));
});
test("BLS error status, wrong series and future months are rejected", () => {
  for (const mutate of [
    (p) => (p.status = "REQUEST_FAILED"),
    (p) => (p.Results.series[0].seriesID = "wrong"),
    (p) => (p.Results.series[0].data[0].year = "2027"),
  ]) {
    const p = fixture.bls();
    mutate(p);
    assert.throws(() => B.parseResponse(p, now));
  }
});
test("mismatched latest release periods fail a family instead of refreshing an older rate", () => {
  const p = fixture.bls();
  p.Results.series[0].data.shift();
  assert.throws(() => B.familyRecords(B.parseResponse(p, now), "cpi", now));
});
test("incomplete index history cannot fabricate previous or use nonadjacent months", () => {
  for (const i of [0, 1, 2, 12, 13]) {
    const p = fixture.bls();
    for (const s of p.Results.series) s.data[i].value = ".";
    assert.throws(() => B.familyRecords(B.parseResponse(p, now), "cpi", now));
  }
});
test("raw evidence and rate validation reject wrong seasonality, series, calculated value and extra fields", () => {
  for (const mutate of [
    (r) => (r.calculation.adjustment = "NSA"),
    (r) => (r.source.series = "CUUR0000SA0"),
    (r) => (r.actual = 0),
    (r) => r.calculation.inputs.pop(),
    (r) => (r.api_key = "secret"),
    (r) => (r.source.api_key = "secret"),
    (r) => (r.forecast = 0.1),
  ]) {
    const r = cpi().cpi_m;
    mutate(r);
    assert.throws(() => D.validateRecord(r, "cpi_m", now));
  }
});
test("BLS revisions are detected from changed published levels even if rounded rate is unchanged", () => {
  const old = cpi().cpi_m,
    p = fixture.bls();
  p.Results.series.find((s) => s.seriesID === "CUSR0000SA0").data[0].value =
    "300.001";
  const r = B.familyRecords(B.parseResponse(p, now), "cpi", now).cpi_m;
  C.revision(r, old);
  assert.equal(r.actual, old.actual);
  assert.equal(r.revision.status, "revised");
  assert.equal(r.revision.detectedAt, r.fetchedAt);
});
test("unchanged/revised status compares previous verified evidence and rejects period regression", () => {
  const old = cpi().cpi_m,
    next = structuredClone(old);
  C.revision(next, old);
  assert.equal(next.revision.status, "unchanged");
  next.observationPeriod = "2026-08";
  assert.throws(() => C.revision(next, old));
});
test("oil subtracts comparable commercial stocks excluding SPR and converts thousand barrels to millions", () => {
  const r = E.normalize(fixture.eia(), now);
  assert.equal(r.actual, -1.4);
  assert.equal(r.previous, -1.4);
  assert.equal(r.source.series, "WCESTUS1");
  assert.equal(r.calculation.inputUnit, "thousand barrels");
  assert.equal(r.forecast, null);
});
test("SPR-inclusive, Cushing, wrong product/geography/process and ambiguous oil units are rejected", () => {
  for (const changes of [
    { series: "WCRSTUS1" },
    { series: "W_EPC0_SAX_YCUOK_MBBL" },
    { product: "EP00" },
    { duoarea: "R10" },
    { process: "SAE" },
    { units: "million barrels" },
  ]) {
    const p = fixture.eia();
    Object.assign(p.response.data[0], changes);
    assert.throws(() => E.normalize(p, now));
  }
});
test("oil missing week, non-Friday period, duplicate week, null stock and future observations rejected", () => {
  for (const mutate of [
    (p) => (p.response.data[1].period = "2026-09-18"),
    (p) => (p.response.data[0].period = "2026-10-08"),
    (p) => (p.response.data[1].period = "2026-10-09"),
    (p) => (p.response.data[0].value = null),
    (p) => (p.response.data[0].period = "2026-10-16"),
  ]) {
    const p = fixture.eia();
    mutate(p);
    assert.throws(() => E.normalize(p, now));
  }
});
test("oil revision to prior week revises both Actual and Previous", () => {
  const old = E.normalize(fixture.eia(), now),
    p = fixture.eia();
  p.response.data[1].value = "432000";
  const r = E.normalize(p, now);
  C.revision(r, old);
  assert.equal(r.actual, -2);
  assert.equal(r.previous, -0.8);
  assert.equal(r.revision.status, "revised");
});
test("combined collection updates seven official fields, leaves ISM and forecasts blank", async () => {
  const r = await U.collectAll({
    config,
    fetcher,
    now,
    keys: { eia: "test-key" },
  });
  assert.equal(r.refreshed, 7);
  for (const id of ["ism", "prices", "employment"])
    assert.equal(r.snapshot.indicators[id].actual, null);
  D.validateSnapshot(r.snapshot, now);
});
test("individual provider switches and keyless BLS v1 keep other provider independent", async () => {
  let calls = [];
  await U.collectAll({
    config: { ...config, eia: { enabled: false } },
    fetcher: async (url, options) => {
      calls.push(url);
      assert.equal(JSON.parse(options.body).registrationkey, undefined);
      return fixture.response(fixture.bls());
    },
    now,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /publicAPI\/v1/);
});
test("registered BLS v2 key lives only in server POST, EIA key only in request", async () => {
  let seen = 0;
  await B.collect({
    key: "synthetic-b-key",
    now,
    fetcher: async (url, options) => {
      assert.match(url, /v2/);
      assert.equal(JSON.parse(options.body).registrationkey, "synthetic-b-key");
      seen++;
      return fixture.response(fixture.bls());
    },
  });
  await E.collect({
    key: "synthetic-e-key",
    now,
    fetcher: async (url) => {
      assert.equal(url.hostname, "api.eia.gov");
      assert.equal(url.searchParams.get("api_key"), "synthetic-e-key");
      seen++;
      return fixture.response(fixture.eia());
    },
  });
  assert.equal(seen, 2);
});
test("temporary BLS failure retains previous actual, evidence and last successful check while EIA succeeds", async () => {
  const old = (
    await U.collectAll({ config, fetcher, now, keys: { eia: "test-key" } })
  ).snapshot;
  const r = await U.collectAll({
    config,
    previous: old,
    now: now + 3600000,
    keys: { eia: "test-key" },
    fetcher: async (url) =>
      String(url).includes("bls.gov")
        ? fixture.response({ status: "REQUEST_FAILED" })
        : fixture.response(fixture.eia()),
  });
  assert.deepEqual(r.snapshot.indicators.cpi_m, old.indicators.cpi_m);
  assert.equal(r.refreshed, 1);
});
test("incomplete CPI family retains its entire verified group while complete PPI updates", async () => {
  const old = (
    await U.collectAll({ config, fetcher, now, keys: { eia: "test-key" } })
  ).snapshot;
  const p = fixture.bls();
  p.Results.series[0].data.shift();
  const r = await U.collectAll({
    config: { ...config, eia: { enabled: false } },
    previous: old,
    now: now + 3600000,
    fetcher: async () => fixture.response(p),
  });
  assert.equal(r.refreshed, 2);
  assert.deepEqual(r.snapshot.indicators.ccpi_m, old.indicators.ccpi_m);
});
test("all failed responses do not return a new snapshot and expose no credentials", async () => {
  await assert.rejects(
    U.collectAll({
      config,
      now,
      fetcher: async () => fixture.response({ status: "REQUEST_FAILED" }),
    }),
    /files unchanged/,
  );
  await assert.rejects(
    H.requestJSON(
      "https://example.invalid/?key=synthetic-secret",
      {},
      async () => {
        throw Error("synthetic-secret");
      },
      async () => {},
    ),
    (e) => !e.message.includes("synthetic-secret"),
  );
});
test("HTTP retry and JSON failure are bounded and redirects disabled", async () => {
  let calls = 0;
  const r = await H.requestJSON(
    "https://example.invalid",
    {},
    async (_, options) => {
      assert.equal(options.redirect, "error");
      calls++;
      return calls < 3 ? { ok: false } : fixture.response({ ok: true });
    },
    async () => {},
  );
  assert.equal(calls, 3);
  assert.deepEqual(r, { ok: true });
});
test("FRED historical fallback enforces source mapping, seasoning, vintage, lag and unreleased-date checks", () => {
  const releases = { release_dates: [{ date: "2026-10-14" }] };
  const r = F.normalize(
    "cpi_m",
    historic(),
    releases,
    fredPayload(),
    null,
    now,
    45,
  );
  assert.equal(r.publicationDate, null);
  assert.equal(r.observations.length, 2);
  for (const mutate of [
    (p) => (p.realtime_start = "2026-10-15"),
    (p) => (p.observations[0].date = "2026-09-01"),
    (p) => (p.count = 999),
    (p) => (p.observations[0].value = "bad"),
  ]) {
    const p = fredPayload();
    mutate(p);
    assert.throws(() =>
      F.normalize("cpi_m", historic(), releases, p, null, now, 45),
    );
  }
  assert.throws(() =>
    F.normalize(
      "cpi_m",
      historic(),
      { release_dates: [{ date: "2026-10-15" }] },
      fredPayload(),
      null,
      now,
      45,
    ),
  );
  const meta = historic();
  meta.seriess[0].seasonal_adjustment = "Not Seasonally Adjusted";
  assert.throws(() =>
    F.normalize("cpi_m", meta, releases, fredPayload(), null, now, 45),
  );
});
test("FRED revisions recorded separately and never masquerade as official publication dates", () => {
  const releases = { release_dates: [{ date: "2026-10-14" }] },
    old = F.normalize(
      "cpi_m",
      historic(),
      releases,
      fredPayload(),
      null,
      now,
      45,
    ),
    p = fredPayload();
  p.observations[0].value = "301";
  const r = F.normalize("cpi_m", historic(), releases, p, old, now, 45);
  assert.equal(r.observations[0].revisionStatus, "revised");
  F.validateHistory(
    {
      schemaVersion: 1,
      notForTrading: true,
      fetchedAt: new Date(now).toISOString(),
      series: [r],
    },
    now,
  );
  assert.equal(r.publicationDate, null);
});
test("public snapshot and history schemas reject future, corrupt and unexpected credential fields", () => {
  D.validateSnapshot(require("../data/economic-data.json"));
  const empty = D.emptySnapshot();
  empty.api_key = "secret";
  assert.throws(() => D.validateSnapshot(empty, now));
  const history = {
    schemaVersion: 1,
    notForTrading: true,
    fetchedAt: null,
    series: [],
    secret: "bad",
  };
  assert.throws(() => F.validateHistory(history, now));
});
test("safe defaults enable official collectors but keep FRED optional and reject unsafe lag", () => {
  U.configValid(require("../config/providers.json"));
  assert.throws(() =>
    U.configValid({ ...config, fred: { enabled: true, minimumLagDays: 0 } }),
  );
  assert.equal(require("../config/providers.json").fred.enabled, false);
});
test("enabled FRED fallback cannot refresh official actuals or last-success timestamps", async () => {
  const fake = async (url) => {
    const u = new URL(url);
    if (u.hostname === "api.bls.gov")
      return fixture.response({ status: "REQUEST_FAILED" });
    const series = u.searchParams.get("series_id");
    const id = Object.keys(F.mapping).find((id) => F.mapping[id] === series);
    if (u.pathname.endsWith("/series"))
      return fixture.response({
        seriess: [
          {
            id: series,
            frequency: "Monthly",
            seasonal_adjustment:
              D.definitions[id].adjustment === "SA"
                ? "Seasonally Adjusted"
                : "Not Seasonally Adjusted",
          },
        ],
      });
    if (u.pathname.endsWith("/series/release"))
      return fixture.response({
        releases: [
          {
            id: 10,
            name:
              D.definitions[id].family === "cpi"
                ? "Consumer Price Index"
                : "Producer Price Index",
          },
        ],
      });
    if (u.pathname.endsWith("/release/dates"))
      return fixture.response({ release_dates: [{ date: "2026-10-14" }] });
    return fixture.response(fredPayload());
  };
  const r = await U.collectAll({
    config: {
      ...config,
      eia: { enabled: false },
      fred: { enabled: true, minimumLagDays: 45 },
    },
    fetcher: fake,
    now,
    keys: { fred: "synthetic-f-key" },
  });
  assert.equal(r.refreshed, 0);
  assert.equal(r.snapshot.generatedAt, null);
  assert.equal(r.snapshot.indicators.cpi_m.lastSuccessfulUpdate, null);
  assert.equal(r.historical.notForTrading, true);
  assert.equal(r.historical.series.length, 6);
  assert.equal(JSON.stringify(r).includes("synthetic-f-key"), false);
});
test("credential guard rejects output before writing and atomic write preserves validated data", async () => {
  const fs = require("node:fs/promises"),
    os = require("node:os"),
    path = require("node:path"),
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "macro-official-"));
  try {
    const file = path.join(dir, "data.json");
    await fs.writeFile(file, "last-verified");
    await assert.rejects(
      U.atomic(file, { note: "synthetic-secret" }, { key: "synthetic-secret" }),
    );
    assert.equal(await fs.readFile(file, "utf8"), "last-verified");
    await U.atomic(file, D.emptySnapshot(), {});
    D.validateSnapshot(JSON.parse(await fs.readFile(file, "utf8")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
