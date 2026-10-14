'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const D = require('../macro-data.js');
function worker(fetcher, seed) {
  const handlers = {}, entries = new Map();
  const dataURL = 'https://example.com/macro-bias-engine/data/economic-data.json';
  if (seed) entries.set(dataURL, new Response(JSON.stringify(seed)));
  const cache = { match: async key => entries.get(typeof key === 'string' ? key : key.url)?.clone(), put: async (key, response) => entries.set(typeof key === 'string' ? key : key.url, response), addAll: async () => {} };
  const caches = { open: async () => cache, match: cache.match, keys: async () => [], delete: async () => true };
  const self = { location: new URL('https://example.com/macro-bias-engine/sw.js'), addEventListener: (name, cb) => handlers[name] = cb, skipWaiting: () => {}, clients: { claim: () => {} } };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../sw.js'), 'utf8'), { self, caches, fetch: fetcher, URL, Response, importScripts: () => {}, MacroData: D });
  return { entries, dataURL, request: async (url, mode = 'cors') => {
    let promise; handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: p => promise = p });
    return await promise;
  } };
}
test('offline economic data uses one canonical cache key without falsifying timestamps', async () => {
  const snapshot = D.emptySnapshot();
  const w = worker(async () => { throw new Error('offline'); }, snapshot);
  const response = await w.request(w.dataURL + '?t=123');
  assert.deepEqual(await response.json(), snapshot);
  assert.equal(w.entries.size, 1);
});
test('uncached offline data is JSON 503, never HTML fallback', async () => {
  const w = worker(async () => { throw new Error('offline'); });
  const response = await w.request(w.dataURL + '?t=123'); assert.equal(response.status, 503); assert.deepEqual(await response.json(), {});
});
test('invalid/failing responses do not replace cached verified snapshot', async () => {
  for (const response of [new Response('<html>oops</html>'), new Response('{}'), new Response('{}', {status:500})]) {
    const seed = D.emptySnapshot(), w = worker(async () => response, seed);
    assert.deepEqual(await (await w.request(w.dataURL + '?t=123')).json(), seed);
  }
});
test('successful data requests use no-store and do not grow timestamped caches', async () => {
  const seed = D.emptySnapshot();
  const w = worker(async (_, options) => { assert.equal(options.cache, 'no-store'); return new Response(JSON.stringify(seed)); });
  await w.request(w.dataURL + '?t=1'); await w.request(w.dataURL + '?t=2'); assert.equal(w.entries.size, 1);
});
