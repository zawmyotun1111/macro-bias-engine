'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function engine(values = {}) {
  const elements = {};
  for (const match of html.matchAll(/<(input|select|div|span)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const [, tag, id] = match;
    let value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || '';
    if (tag === 'select') value = html.slice(match.index).match(/<option value="([^"]*)"/)?.[1] || '';
    elements[id] = { value, textContent: '', innerHTML: '', style: {} };
  }
  Object.entries(values).forEach(([id, value]) => elements[id].value = String(value));
  const context = vm.createContext({ document: { getElementById: id => elements[id] }, navigator: {}, window: {} });
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(script[1], context);
  return { elements, analyze: () => vm.runInContext('analyze()', context), v2: () => vm.runInContext('analyzeV2()', context), context };
}
const neutral = { trend: 0, structure: 0, location: 0, liquidity: 0, breakout: 0 };
test('missing Actual/Forecast/Previous never become zero or fabricated surprises', () => {
  const e = engine({ cpi_m: 0.2 }); e.analyze(); assert.equal(e.elements.score.textContent, '+0.0');
  e.elements.cpi_m.value = '0.2junk'; e.analyze(); assert.equal(e.elements.score.textContent, '+0.0');
  const zero = engine({ cpi_m: 0, cpi_m_f: 0.1 }); zero.analyze(); assert.equal(zero.elements.score.textContent, '+1.3');
});
test('each inflation weight and previous trend matches V1, plus DXY/Yield signs', () => {
  const weights = { ccpi_m: 2, ccpi_y: 2.6, cpi_m: 1.3, cpi_y: 1.5, cppi_m: 1.8, ppi_m: 1.1 };
  for (const [id, weight] of Object.entries(weights)) {
    for (const [actual, expected] of [[0.1, weight], [0.3, -weight], [0.2, 0]]) {
      const e = engine({ [id]: actual, [id + '_f']: 0.2 }); e.analyze();
      assert.equal(Number(e.elements.score.textContent), Number(expected.toFixed(1)));
    }
    const e = engine({ [id]: 0.1, [id + '_p']: 0.2 }); e.analyze();
    assert.equal(Number(e.elements.score.textContent), Number((weight * .35).toFixed(1)));
  }
  const e = engine({ dxy: 1, yield: 1 }); e.analyze(); assert.equal(e.elements.score.textContent, '+3.0');
});
test('equal consensus/previous does not create a negative surprise for ISM prices or oil', () => {
  const e = engine({ ism: 54, ism_f: 54, ism_p: 54, prices: 60, prices_f: 60, prices_p: 60, oil: 1, oil_f: 1 });
  e.analyze(); assert.equal(e.elements.score.textContent, '+0.0');
});
test('ISM contraction, employment and crude-inventory logic retained', () => {
  const e = engine({ ism: 49, ism_f: 50, ism_p: 51, prices: 60, prices_f: 61, prices_p: 62, employment: 49, oil: 4, oil_f: 3 });
  e.analyze(); assert.equal(e.elements.score.textContent, '+4.8'); assert.equal(e.elements.bias.textContent, 'BULLISH');
});
test('original complete example preserves V1 score, probability bounds and default V2 setup', () => {
  // Synthetic regression vector from the original demo, never published as live data.
  const e = engine({ ccpi_m:.2, ccpi_m_f:.2, ccpi_m_p:0, ccpi_y:2.5, ccpi_y_f:2.5, ccpi_y_p:2.6,
    cpi_m:.1, cpi_m_f:.1, cpi_m_p:-.4, cpi_y:3.4, cpi_y_f:3.4, cpi_y_p:3.5,
    cppi_m:.2, cppi_m_f:.3, cppi_m_p:.4, ppi_m:0, ppi_m_f:.2, ppi_m_p:-.1,
    ism:54.1, ism_f:54.5, ism_p:54, prices:70.3, prices_p:67.7, employment:47.4, oil:17.4, oil_f:-1.2 });
  e.v2(); assert.equal(e.elements.score.textContent, '+5.0'); assert.equal(e.elements.v2score.textContent, '+15.6');
  assert.equal(e.elements.v2bias.textContent, 'LONG BIAS');
  const bull = parseInt(e.elements.bullbar.style.width); assert.ok(bull >= 5 && bull <= 95);
  assert.equal(bull + parseInt(e.elements.bearbar.style.width), 100);
});
test('V2 D1 weights, short/long thresholds and A/B/C grades retained for both assets', () => {
  for (const asset of ['BTC', 'XAU']) {
    for (const [values, score, bias, grade] of [
      [{ ...neutral }, 0, 'WAIT / NO TRADE', '—'],
      [{ ...neutral, trend: 1, structure: 1 }, 4, 'LONG BIAS', 'C'],
      [{ ...neutral, trend: -1, structure: -1 }, -4, 'SHORT BIAS', 'C'],
      [{ ...neutral, trend: 1, structure: 1, liquidity: 1 }, 6, 'LONG BIAS', 'B'],
      [{ trend: 1, structure: 1, location: 1, liquidity: 2, breakout: 2 }, 13.2, 'LONG BIAS', 'A']]) {
      const e = engine({ ...values, asset }); e.v2();
      assert.equal(Number(e.elements.v2score.textContent), score); assert.equal(e.elements.v2bias.textContent, bias);
      assert.equal(e.elements.v2grade.textContent, `Setup quality: ${grade} | Asset: ${asset}`);
    }
  }
});
test('V2 macro cap, cross-market directions and Fed path', () => {
  const e = engine({ ...neutral, cpi_m:0.1, cpi_m_f:0.2, ccpi_y:2, ccpi_y_f:3 }); e.v2(); assert.equal(e.elements.v2score.textContent, '+2.4');
  const falling = engine({ ...neutral, dxyTrend:1, us10yTrend:1 }); falling.v2(); assert.equal(falling.elements.v2score.textContent, '+3.0');
  const rising = engine({ ...neutral, dxyTrend:-1, us10yTrend:-1 }); rising.v2(); assert.equal(rising.elements.v2score.textContent, '-3.0');
  const markets = engine({ ...neutral, spxTrend:1, ndxTrend:1, oilTrend:1 }); markets.v2(); assert.equal(markets.elements.v2score.textContent, '+0.9');
  const fed = engine({ ...neutral, fedBias:1, fedPath:1, fedRate:5, nextFedRate:4.5 }); fed.v2(); assert.equal(fed.elements.v2score.textContent, '+3.8');
});
test('position sizing and R:R retained for valid long and short trades', () => {
  for (const [stop, target] of [[90, 120], [110, 80]]) {
    const e = engine({ entry:100, stop, target, capital:50000, riskpct:.5 }); e.v2();
    assert.match(e.elements.riskresult.innerHTML, /Risk amount: 250.00/);
    assert.match(e.elements.riskresult.innerHTML, /Estimated position size: 25.0000 units/);
    assert.match(e.elements.riskresult.innerHTML, /1:2.00/);
  }
});
test('zero stop distance, negative capital/risk, excessive risk and same-side stop/target cannot size a trade', () => {
  for (const changes of [{ stop:100 }, { capital:-1 }, { riskpct:-1 }, { riskpct:101 }, { stop:0 }, { target:80 }, { target:'' }]) {
    const e = engine({ entry:100, stop:90, target:120, capital:50000, riskpct:.5, ...changes }); e.v2();
    assert.doesNotMatch(e.elements.riskresult.innerHTML, /Estimated position size/);
    assert.match(e.elements.riskresult.innerHTML, /Invalid or incomplete/);
  }
});
