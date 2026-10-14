'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { definitions, timestamp, officialURL, numeric, validateSnapshot, validateRecord, emptySnapshot, requireCondition } = require('../macro-data.js');

// TE ISO timestamps without an offset are UTC, never local browser/server time.
function providerDate(value) {
  requireCondition(typeof value === 'string', 'Missing provider date');
  const utc = value.endsWith('Z') ? value : value + 'Z';
  timestamp(utc);
  return new Date(utc).toISOString();
}
function parseValue(value, unit, definition) {
  if (value === null || value === undefined || value === '' || (typeof value === 'string' && /^(?:\s*|N\/A|null|--)$/i.test(value))) return null;
  requireCondition(typeof value === 'string' || typeof value === 'number', 'Invalid value type');
  const match = String(value).trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(%|M)?$/);
  requireCondition(match, 'Malformed economic value');
  const suffix = match[2] || '';
  if (definition.unit === '%') requireCondition(suffix === '%' || (!suffix && unit === '%'), 'Expected percentage');
  if (definition.unit === 'index') requireCondition(!suffix && ['', 'Points', 'points', 'index'].includes(unit || ''), 'Expected index points');
  if (definition.unit === 'million barrels') requireCondition(suffix === 'M' || (!suffix && ['M', 'million barrels'].includes(unit)), 'Ambiguous inventory units');
  return numeric(Number(match[1]), definition);
}
function normalize(event, id, now) {
  const d = definitions[id];
  requireCondition(event.Country === 'United States' && event.Event === d.event && String(event.DateSpan) === '0', 'Wrong/estimated event');
  const releaseDate = providerDate(event.Date), providerUpdatedAt = providerDate(event.LastUpdate);
  requireCondition(Date.parse(releaseDate) <= now, 'Unreleased event');
  const sourceURL = officialURL(event.SourceURL, d.host);
  const actual = parseValue(event.Actual, event.Unit, d);
  requireCondition(actual !== null, 'No actual release');
  const forecast = parseValue(event.Forecast, event.Unit, d); // Never substitute TEForecast.
  const record = {
    actual, forecast, previous: parseValue(event.Previous, event.Unit, d),
    forecastKind: forecast === null ? null : 'consensus-estimate', unit: d.unit, status: 'released',
    releaseDate, providerUpdatedAt, lastSuccessfulUpdate: new Date(now).toISOString(),
    source: { name: event.Source, url: sourceURL, provider: 'Trading Economics' },
    reference: event.Reference, calendarId: String(event.CalendarId)
  };
  validateRecord(record, id, now);
  return record;
}
function buildSnapshot(events, previous = emptySnapshot(), now = Date.now()) {
  requireCondition(Array.isArray(events) && events.length > 0, 'Empty/invalid calendar response');
  validateSnapshot(previous, now);
  const result = structuredClone(previous);
  let refreshed = 0;
  const warnings = [];
  for (const [id, definition] of Object.entries(definitions)) {
    const candidates = events.filter(e => e && e.Country === 'United States' && e.Event === definition.event);
    // Choose the latest released row first. A malformed latest release must NOT allow
    // an older valid row to advance the success timestamp and conceal a failed update.
    const released = candidates.filter(e => typeof e.Date !== 'string' || (() => { try { return Date.parse(providerDate(e.Date)) <= now; } catch { return true; } })());
    released.sort((a, b) => String(b.Date).localeCompare(String(a.Date)) || String(b.LastUpdate).localeCompare(String(a.LastUpdate)));
    if (!released.length) { warnings.push(id + ': no released data; kept last verified values'); continue; }
    try {
      const record = normalize(released[0], id, now);
      const old = previous.indicators[id];
      requireCondition(!old.releaseDate || record.releaseDate >= old.releaseDate, 'Release regression');
      if (record.releaseDate === old.releaseDate) {
        requireCondition(record.calendarId === old.calendarId && record.reference === old.reference, 'Conflicting release identity');
        requireCondition(record.providerUpdatedAt >= old.providerUpdatedAt, 'Revision regression');
      }
      const sameTime = released.filter(e => e.Date === released[0].Date && e.LastUpdate === released[0].LastUpdate);
      for (const duplicate of sameTime) requireCondition(JSON.stringify(normalize(duplicate, id, now)) === JSON.stringify(record), 'Conflicting duplicate releases');
      result.indicators[id] = record;
      refreshed++;
    } catch { warnings.push(id + ': validation failed; kept last verified values'); }
  }
  requireCondition(refreshed > 0, 'No indicators passed release validation');
  result.generatedAt = new Date(now).toISOString();
  validateSnapshot(result, now);
  return { snapshot: result, refreshed, warnings };
}
async function fetchCalendar(key, now = Date.now(), fetcher = fetch, pause = ms => new Promise(r => setTimeout(r, ms))) {
  requireCondition(typeof key === 'string' && key.trim() && !/guest/i.test(key), 'Set the licensed TRADING_ECONOMICS_API_KEY Actions secret');
  const day = 86400000, date = ms => new Date(ms).toISOString().slice(0, 10);
  const end = Math.floor(now / day) * day, start = end - 62 * day;
  const rows = [];
  // Small date windows avoid the provider's 1000-row response limit.
  for (let cursor = start; cursor <= end; cursor += 7 * day) {
    const url = new URL(`https://api.tradingeconomics.com/calendar/country/united%20states/${date(cursor)}/${date(Math.min(end, cursor + 6 * day))}`);
    url.searchParams.set('c', key); url.searchParams.set('f', 'json');
    let batch;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (response.status === 429 || response.status >= 500) throw new Error('retry');
        requireCondition(response.ok, 'Provider access denied; check subscription/secret');
        const text = await response.text();
        requireCondition(text.length < 5000000, 'Oversized provider response');
        batch = JSON.parse(text);
        requireCondition(Array.isArray(batch) && batch.length < 1000, 'Invalid/truncated provider response');
        break;
      } catch {
        // URLs and provider errors may contain credentials. Never log them.
        if (attempt === 2) throw new Error('Calendar request failed; check provider access, quota and network');
        await pause(1000 * (attempt + 1));
      }
    }
    rows.push(...batch);
    if (cursor + 7 * day <= end) await pause(1100);
  }
  return rows;
}
async function main() {
  const file = path.join(__dirname, '../data/economic-data.json');
  const previous = JSON.parse(await fs.readFile(file, 'utf8'));
  const events = await fetchCalendar(process.env.TRADING_ECONOMICS_API_KEY);
  const { snapshot, refreshed, warnings } = buildSnapshot(events, previous);
  const serialized = JSON.stringify(snapshot, null, 2) + '\n';
  requireCondition(!serialized.includes(process.env.TRADING_ECONOMICS_API_KEY), 'Credential detected in output');
  await fs.writeFile(file + '.tmp', serialized);
  await fs.rename(file + '.tmp', file);
  console.log(`Validated ${refreshed}/${Object.keys(definitions).length} indicators.`);
  warnings.forEach(message => console.warn(message));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { providerDate, parseValue, normalize, buildSnapshot, fetchCalendar };
