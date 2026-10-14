'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./fixtures/legacy/macro-data.cjs');
const U = require('./fixtures/legacy/calendar.cjs');
const now = Date.parse('2026-10-14T18:00:00Z');
function event(id = 'cpi_m', changes = {}) {
  const d = D.definitions[id];
  return { CalendarId: '1001', Country: 'United States', Event: d.event, Date: '2026-10-14T12:30:00',
    LastUpdate: '2026-10-14T12:31:00', DateSpan: '0', Source: 'Test source (synthetic fixture)', SourceURL: 'https://www.' + d.host,
    Reference: 'Sep', Unit: d.unit === '%' ? '%' : d.unit === 'index' ? '' : 'M',
    Actual: d.unit === '%' ? '0.2%' : d.unit === 'index' ? '52.1' : '-3.4M',
    Previous: '', Forecast: '', TEForecast: '99', ...changes };
}
test('committed snapshot validates and blank bootstrap contains no fabricated values', () => {
  const data = D.emptySnapshot(); // retired v1 contract fixture; production v2 tested separately
  D.validateSnapshot(data);
  for (const r of Object.values(D.emptySnapshot().indicators)) assert.equal(r.actual, null);
});
test('all ten fields map exactly to the correct services/BLS/EIA events and units', () => {
  const result = U.buildSnapshot(Object.keys(D.definitions).map(id => event(id)), undefined, now);
  assert.equal(result.refreshed, 10);
  assert.equal(result.snapshot.indicators.oil.actual, -3.4);
  assert.equal(result.snapshot.indicators.ism.actual, 52.1);
  assert.equal(result.snapshot.indicators.cpi_m.actual, 0.2);
  assert.equal(result.snapshot.indicators.cpi_m.forecast, null);
  assert.equal(result.snapshot.indicators.cpi_m.forecastKind, null);
});
test('zero is real; forecast remains a labelled consensus estimate; Previous is provider revised value', () => {
  const r = U.normalize(event('cpi_m', { Actual: '0%', Forecast: '0.1%', Previous: '-0.2%', Revised: '-0.3%' }), 'cpi_m', now);
  assert.equal(r.actual, 0); assert.equal(r.previous, -0.2);
  assert.equal(r.forecast, 0.1); assert.equal(r.forecastKind, 'consensus-estimate');
});
test('strict numbers reject partial, ambiguous, nonfinite, out of range and wrong units', () => {
  for (const value of ['0.2 junk', '1,000%', 'NaN', 'Infinity', false, {}, '23%']) assert.throws(() => U.parseValue(value, '%', D.definitions.cpi_m));
  assert.throws(() => U.parseValue('123', '', D.definitions.oil));
  assert.throws(() => U.parseValue('50%', '', D.definitions.ism));
  assert.throws(() => U.parseValue('-1', '', D.definitions.ism));
  for (const value of ['', ' ', null, undefined, 'N/A', '--']) assert.equal(U.parseValue(value, '%', D.definitions.cpi_m), null);
});
test('verified releases require exact indicator, source host, identity, reference, actual and consistent UTC dates', () => {
  const invalid = [{ Actual: '' }, { Event: 'Core Inflation Rate MoM' }, { Country: 'Canada' }, { DateSpan: '1' },
    { Date: '2026-10-15T12:30:00' }, { Date: '2026-02-30T12:30:00' }, { Date: 'garbage' },
    { LastUpdate: '2026-10-14T12:29:00' }, { LastUpdate: '2026-10-15T12:31:00' },
    { SourceURL: 'https://www.bls.gov.evil.example/' }, { SourceURL: 'javascript:alert(1)' },
    { SourceURL: 'https://www.bls.gov/?key=secret' }, { Source: '' }, { CalendarId: undefined }, { Reference: '' }];
  for (const changes of invalid) assert.throws(() => U.normalize(event('cpi_m', changes), 'cpi_m', now), JSON.stringify(changes));
});
test('future release cannot overwrite the latest released actual or lend its forecast to it', () => {
  const result = U.buildSnapshot([event(), event('cpi_m', { Date: '2026-10-15T12:30:00', Forecast: '0.7%', Actual: '' })], undefined, now);
  assert.equal(result.snapshot.indicators.cpi_m.forecast, null);
});
test('manufacturing PMI, API oil and Cushing oil never match required services/EIA totals', () => {
  for (const Event of ['ISM Manufacturing PMI', 'ISM Manufacturing Prices', 'API Crude Oil Stock Change', 'EIA Cushing Crude Oil Stocks Change'])
    assert.throws(() => U.buildSnapshot([event('ism', { Event })], undefined, now));
});
test('failed latest row, regression or conflicting duplicate preserves last verified values and success time', () => {
  const old = U.buildSnapshot([event()], undefined, now - 3600000).snapshot;
  for (const changes of [{ Actual: 'bad' }, { LastUpdate: '2026-10-14T12:30:30' },
    { Date: '2026-10-13T12:30:00' }, { CalendarId: '1002' }, { Reference: 'Aug' }]) {
    const result = U.buildSnapshot([event('cpi_m', changes), event('ism')], old, now);
    assert.deepEqual(result.snapshot.indicators.cpi_m, old.indicators.cpi_m);
    assert.equal(result.warnings.some(w => w.startsWith('cpi_m:')), true);
  }
  const conflict = U.buildSnapshot([event(), event('cpi_m', { Actual: '0.3%' }), event('ism')], old, now);
  assert.deepEqual(conflict.snapshot.indicators.cpi_m, old.indicators.cpi_m);
});
test('a newer due-but-missing Actual never advances the older successful-check time', () => {
  const old = U.buildSnapshot([event('cpi_m', { Date: '2026-10-13T12:30:00', LastUpdate: '2026-10-13T12:31:00' })], undefined, now - 3600000).snapshot;
  const result = U.buildSnapshot([event('cpi_m', { Date: '2026-10-13T12:30:00', LastUpdate: '2026-10-13T12:31:00' }), event('cpi_m', { Actual: '' }), event('ism')], old, now);
  assert.deepEqual(result.snapshot.indicators.cpi_m, old.indicators.cpi_m);
});
test('valid revision updates actual and previous; provider projection never substituted', () => {
  const old = U.buildSnapshot([event()], undefined, now - 3600000).snapshot;
  const result = U.buildSnapshot([event('cpi_m', { Actual: '0.3%', Previous: '0.1%', LastUpdate: '2026-10-14T17:00:00' })], old, now);
  assert.equal(result.snapshot.indicators.cpi_m.actual, 0.3);
  assert.equal(result.snapshot.indicators.cpi_m.previous, 0.1);
  assert.equal(result.snapshot.indicators.cpi_m.forecast, null);
});
test('schema validation rejects missing fields, corrupt types, unsupported unit and future timestamps', () => {
  const data = U.buildSnapshot([event()], undefined, now).snapshot;
  for (const mutate of [d => delete d.indicators.ism, d => d.schemaVersion = 2,
    d => d.indicators.cpi_m.actual = '0.2', d => d.indicators.cpi_m.unit = 'index',
    d => d.indicators.cpi_m.forecast = 1, d => d.generatedAt = '2026-10-15T00:00:00Z',
    d => d.indicators.ism.actual = 10]) {
    const copy = structuredClone(data); mutate(copy); assert.throws(() => D.validateSnapshot(copy, now));
  }
});
test('freshness tracks both release cadence and last successful verification, including offline', () => {
  const record = U.normalize(event(), 'cpi_m', now);
  assert.equal(D.freshness(record, 'cpi_m', now), 'fresh');
  assert.equal(D.freshness(record, 'cpi_m', now + 37 * 3600000), 'stale');
  assert.equal(D.freshness(D.emptyRecord('ism'), 'ism', now), 'unavailable');
  const old = { ...record, releaseDate: '2026-09-01T00:00:00Z', providerUpdatedAt: '2026-09-01T00:00:00Z' };
  assert.equal(D.freshness(old, 'oil', now), 'stale');
});
test('empty/error responses and all-invalid releases fail closed', () => {
  for (const response of [[], {}, null, [event('cpi_m', { Actual: 'bad' })]]) assert.throws(() => U.buildSnapshot(response, undefined, now));
});
test('fetch uses bounded date windows, retries safely, and never exposes key or response errors', async () => {
  let calls = 0;
  const fake = async (url, options) => {
    assert.equal(url.hostname, 'api.tradingeconomics.com'); assert.equal(options.redirect, 'error');
    assert.equal(url.searchParams.get('c'), 'synthetic-test-key');
    calls++; if (calls === 1) return { status: 429 };
    return { status: 200, ok: true, text: async () => JSON.stringify([event()]) };
  };
  assert.equal((await U.fetchCalendar('synthetic-test-key', now, fake, async () => {})).length, 9);
  assert.equal(calls, 10);
  for (const response of [{ status: 401, ok: false }, { status: 200, ok: true, text: async () => 'key=secret' },
    { status: 200, ok: true, text: async () => JSON.stringify(Array(1000).fill(event())) }]) {
    await assert.rejects(U.fetchCalendar('synthetic-test-key', now, async () => response, async () => {}), error => !error.message.includes('synthetic-test-key') && !error.message.includes('secret'));
  }
  await assert.rejects(U.fetchCalendar('', now));
});

