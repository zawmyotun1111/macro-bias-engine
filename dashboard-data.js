'use strict';
(function () {
  const D = window.MacroData;
  const ids = Object.keys(D.definitions);
  let snapshot = D.emptySnapshot(), manual = false, busy = false, hasSnapshot = false;
  const $ = id => document.getElementById(id);
  function inputMode() {
    for (const id of ids) for (const suffix of ['', '_f', '_p']) $(id + suffix).readOnly = !manual;
    $('manualOverride').textContent = manual ? 'Use Verified Data' : 'Manual Override';
    $('clearData').disabled = !manual;
    $('dataMode').textContent = manual ? 'MANUAL OVERRIDE — unverified inputs; automatic refresh will not replace them.' : 'Verified releases via Trading Economics. Forecasts are consensus estimates, not released facts.';
  }
  function applyValues() {
    for (const id of ids) {
      const r = snapshot.indicators[id];
      for (const [field, suffix] of [['actual', ''], ['forecast', '_f'], ['previous', '_p']]) $(id + suffix).value = r[field] === null ? '' : r[field];
    }
  }
  function recalculate() {
    analyzeV2(); // Preserves the user's selected asset and D1/risk inputs.
    $('btcMacroBias').textContent = $('bias').textContent + ' | score ' + $('score').textContent;
    $('goldMacroBias').textContent = $('btcMacroBias').textContent;
    const usable = ids.filter(id => snapshot.indicators[id].status === 'released').length;
    $('biasDataStatus').textContent = manual ? 'Calculated from manual, unverified inputs.' :
      `Calculated from ${usable}/${ids.length} verified indicators. V1 uses the same macro model for BTC and Gold; V2 adds your selected asset and D1 inputs.`;
    if (!manual && !usable) {
      $('btcMacroBias').textContent = $('goldMacroBias').textContent = 'Unavailable — no verified releases';
      $('score').textContent = '—'; $('bias').textContent = 'No verified economic data';
    }
  }
  function date(value) { return value ? new Date(value).toLocaleString(undefined, { timeZoneName: 'short' }) : '—'; }
  function renderMetadata() {
    const container = $('releaseMetadata'); container.replaceChildren();
    let stale = 0, missing = 0;
    for (const id of ids) {
      const r = snapshot.indicators[id], status = D.freshness(r, id);
      if (status === 'stale') stale++; if (status === 'unavailable') missing++;
      const row = document.createElement('div'); row.className = 'release-row';
      const title = document.createElement('strong'); title.textContent = D.definitions[id].name + ' — ' + status;
      row.append(title);
      const detail = document.createElement('div'); detail.className = 'note';
      detail.textContent = `Release: ${date(r.releaseDate)} | Period: ${r.reference || '—'} | Last successful update: ${date(r.lastSuccessfulUpdate)} | Provider revision: ${date(r.providerUpdatedAt)}`;
      row.append(detail);
      if (r.source) {
        const source = document.createElement('a'); source.href = D.officialURL(r.source.url, D.definitions[id].host);
        source.textContent = r.source.name; source.target = '_blank'; source.rel = 'noopener noreferrer';
        row.append(source, document.createTextNode(' via ' + r.source.provider + (r.forecast !== null ? ' | Forecast: consensus estimate' : ' | Forecast unavailable')));
      } else row.append(document.createTextNode('Source: — | No verified release available'));
      container.append(row);
      const inputRow = $(id).parentElement;
      inputRow.dataset.freshness = status;
      inputRow.title = manual ? 'Manual/unverified input' : `${status} | ${D.definitions[id].name} | released ${date(r.releaseDate)}`;
    }
    $('staleWarning').hidden = !stale && !missing;
    $('staleWarning').textContent = `${stale} stale and ${missing} unavailable indicators. Bias may be incomplete or outdated. Unavailable values stay blank; retained stale values remain visible.`;
  }
  async function refreshData() {
    if (busy) return;
    busy = true; $('refreshData').disabled = true;
    $('refreshStatus').textContent = 'Checking published data…';
    try {
      const response = await fetch('./data/economic-data.json?t=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP failure');
      const next = D.validateSnapshot(await response.json());
      // Cached/stale responses must never roll a newer validated release backward.
      if (snapshot.generatedAt && (!next.generatedAt || next.generatedAt < snapshot.generatedAt)) throw new Error('Older snapshot');
      for (const id of ids) {
        const old = snapshot.indicators[id], r = next.indicators[id];
        if (old.releaseDate && (!r.releaseDate || r.releaseDate < old.releaseDate || r.lastSuccessfulUpdate < old.lastSuccessfulUpdate)) throw new Error('Older release');
      }
      snapshot = next; hasSnapshot = true;
      if (!manual) { applyValues(); recalculate(); }
      renderMetadata();
      $('refreshStatus').textContent = 'Published snapshot: ' + date(snapshot.generatedAt) + (manual ? ' | Manual inputs kept.' : ' | Bias recalculated.');
    } catch {
      $('refreshStatus').textContent = 'Refresh failed. Last verified data retained; check connection and GitHub Actions.';
    } finally { busy = false; $('refreshData').disabled = false; }
  }
  function toggleManual() {
    manual = !manual; inputMode();
    if (!manual) applyValues();
    renderMetadata(); recalculate();
  }
  function clearManual() {
    if (!manual) return;
    for (const id of ids) for (const suffix of ['', '_f', '_p']) $(id + suffix).value = '';
    recalculate();
  }
  $('refreshData').addEventListener('click', refreshData);
  $('manualOverride').addEventListener('click', toggleManual);
  $('clearData').addEventListener('click', clearManual);
  $('analyzeMacro').addEventListener('click', recalculate);
  $('runV2').addEventListener('click', recalculate);
  ids.forEach(id => ['', '_f', '_p'].forEach(suffix => {
    const el = $(id + suffix); el.placeholder = ''; el.type = 'number'; el.step = 'any';
    el.setAttribute('aria-label', D.definitions[id].name + ' ' + ({'': 'Actual', '_f': 'Forecast consensus estimate', '_p': 'Previous'})[suffix]);
    el.addEventListener('input', () => { if (manual) recalculate(); });
  }));
  inputMode(); renderMetadata(); refreshData();
  setInterval(() => { renderMetadata(); if (!manual && hasSnapshot) $('biasDataStatus').textContent = `Verified data mode. ${ids.filter(id => D.freshness(snapshot.indicators[id], id) === 'fresh').length}/${ids.length} fresh indicators. Forecasts remain estimates.`; }, 60000);
  setInterval(refreshData, 15 * 60000);
})();
