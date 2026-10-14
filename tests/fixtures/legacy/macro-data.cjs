(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MacroData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const definitions = {
    ccpi_m: { name: 'Core CPI m/m', event: 'Core Inflation Rate MoM', unit: '%', host: 'bls.gov', maxAgeDays: 45, range: [-20, 20] },
    ccpi_y: { name: 'Core CPI y/y', event: 'Core Inflation Rate YoY', unit: '%', host: 'bls.gov', maxAgeDays: 45, range: [-30, 100] },
    cpi_m: { name: 'CPI m/m', event: 'Inflation Rate MoM', unit: '%', host: 'bls.gov', maxAgeDays: 45, range: [-20, 20] },
    cpi_y: { name: 'CPI y/y', event: 'Inflation Rate YoY', unit: '%', host: 'bls.gov', maxAgeDays: 45, range: [-30, 100] },
    cppi_m: { name: 'Core PPI m/m', event: 'Core PPI MoM', unit: '%', host: 'bls.gov', maxAgeDays: 45, range: [-20, 20] },
    ppi_m: { name: 'PPI m/m', event: 'PPI MoM', unit: '%', host: 'bls.gov', maxAgeDays: 45, range: [-20, 20] },
    ism: { name: 'ISM Services PMI', event: 'ISM Services PMI', unit: 'index', host: 'ismworld.org', maxAgeDays: 40, range: [0, 100] },
    prices: { name: 'ISM Services Prices Paid', event: 'ISM Services Prices', unit: 'index', host: 'ismworld.org', maxAgeDays: 40, range: [0, 100] },
    employment: { name: 'ISM Services Employment', event: 'ISM Services Employment', unit: 'index', host: 'ismworld.org', maxAgeDays: 40, range: [0, 100] },
    oil: { name: 'EIA Crude Oil Inventories change', event: 'EIA Crude Oil Stocks Change', unit: 'million barrels', host: 'eia.gov', maxAgeDays: 10, range: [-100, 100] }
  };
  function requireCondition(condition, message) { if (!condition) throw new Error(message); }
  function timestamp(value) {
    requireCondition(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value), 'Invalid UTC timestamp');
    const ms = Date.parse(value);
    requireCondition(Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19), 'Invalid date');
    return ms;
  }
  function officialURL(value, host) {
    const url = new URL(value);
    requireCondition(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      (url.hostname === host || url.hostname.endsWith('.' + host)) && !url.search && !url.hash, 'Untrusted source URL');
    url.protocol = 'https:';
    return url.href;
  }
  function numeric(value, definition) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    requireCondition(typeof value === 'number' && Number.isFinite(value) && value >= definition.range[0] && value <= definition.range[1], 'Invalid numeric value');
    return value;
  }
  function validateRecord(record, id, now) {
    const d = definitions[id];
    requireCondition(d && record && typeof record === 'object', 'Unknown indicator');
    requireCondition(record.unit === d.unit && ['released', 'unavailable'].includes(record.status), 'Invalid indicator status/unit');
    for (const field of ['actual', 'forecast', 'previous']) {
      requireCondition(record[field] === null || typeof record[field] === 'number', 'Use null for unavailable values');
      numeric(record[field], d);
    }
    requireCondition(record.forecastKind === (record.forecast === null ? null : 'consensus-estimate'), 'Forecast must be labelled consensus estimate');
    if (record.status === 'unavailable') {
      requireCondition(['actual', 'forecast', 'previous', 'releaseDate', 'lastSuccessfulUpdate', 'source', 'providerUpdatedAt', 'reference', 'calendarId'].every(k => record[k] === null), 'Unavailable record must be blank');
      return record;
    }
    requireCondition(record.actual !== null, 'Released actual is required');
    const release = timestamp(record.releaseDate), success = timestamp(record.lastSuccessfulUpdate), updated = timestamp(record.providerUpdatedAt);
    requireCondition(release <= now && release <= success && success <= now && updated >= release && updated <= success, 'Inconsistent/future dates');
    requireCondition(record.source && record.source.provider === 'Trading Economics' && typeof record.source.name === 'string' && record.source.name.length > 0 && record.source.name.length <= 160, 'Missing source');
    officialURL(record.source.url, d.host);
    requireCondition(typeof record.calendarId === 'string' && /^\d+$/.test(record.calendarId), 'Missing release identity');
    requireCondition(typeof record.reference === 'string' && record.reference.length > 0 && record.reference.length <= 80, 'Missing reference period');
    return record;
  }
  function validateSnapshot(data, now = Date.now()) {
    requireCondition(data && data.schemaVersion === 1 && data.indicators && typeof data.indicators === 'object', 'Invalid snapshot schema');
    requireCondition(Object.keys(data.indicators).length === Object.keys(definitions).length, 'Wrong indicator count');
    requireCondition(data.generatedAt === null || timestamp(data.generatedAt) <= now, 'Future snapshot');
    for (const id of Object.keys(definitions)) {
      validateRecord(data.indicators[id], id, now);
      if (data.indicators[id].lastSuccessfulUpdate !== null) requireCondition(data.generatedAt !== null && timestamp(data.indicators[id].lastSuccessfulUpdate) <= timestamp(data.generatedAt), 'Snapshot predates data');
    }
    return data;
  }
  function emptyRecord(id) {
    return { actual: null, forecast: null, previous: null, forecastKind: null, unit: definitions[id].unit,
      status: 'unavailable', releaseDate: null, lastSuccessfulUpdate: null, providerUpdatedAt: null, source: null, reference: null, calendarId: null };
  }
  function emptySnapshot() {
    return { schemaVersion: 1, generatedAt: null, indicators: Object.fromEntries(Object.keys(definitions).map(id => [id, emptyRecord(id)])) };
  }
  function freshness(record, id, now = Date.now()) {
    if (record.status !== 'released') return 'unavailable';
    if (now - timestamp(record.lastSuccessfulUpdate) > 36 * 3600000 || now - timestamp(record.releaseDate) > definitions[id].maxAgeDays * 86400000) return 'stale';
    return 'fresh';
  }
  return { definitions, timestamp, officialURL, numeric, validateRecord, validateSnapshot, emptyRecord, emptySnapshot, freshness, requireCondition };
});
