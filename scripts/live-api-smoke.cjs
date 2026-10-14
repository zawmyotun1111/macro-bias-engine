'use strict';
// Read-only live smoke harness. Provider bodies, URLs with credentials, and errors are never logged.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.SOURCE_ROOT || path.join(__dirname, '..'));
const D = require(path.join(root, 'macro-data.js'));
const B = require(path.join(root, 'providers/bls.cjs'));
const E = require(path.join(root, 'providers/eia.cjs'));
const key = process.env.EIA_API_KEY;
const report = {schemaVersion:1, checkedAt:new Date().toISOString(), testedCommit:process.env.TESTED_COMMIT || 'local', writesProductionData:false, providers:{}};
const observations = {BLS:[], EIA:[]};
function makeFetcher(provider) {
  return async (url, options) => {
    const r = await fetch(url, options);
    const diagnostic = {httpStatus:r.status};
    observations[provider].push(diagnostic);
    if (r.ok) {
      try {
        const data = await r.clone().json();
        if (provider === 'BLS') diagnostic.blsStatus = ['REQUEST_SUCCEEDED','REQUEST_FAILED','REQUEST_NOT_PROCESSED'].includes(data.status) ? data.status : 'unrecognized';
        else {
          const b = data.response;
          diagnostic.weeklyFrequency = b?.frequency === 'weekly';
          diagnostic.rowCount = Array.isArray(b?.data) ? b.data.length : 0;
          diagnostic.rows = (Array.isArray(b?.data) ? b.data : []).slice(0,3).map(x => ({
            seriesMatches:x.series === 'WCESTUS1', productMatches:x.product === 'EPC0', processMatches:x.process === 'SAX', areaMatches:x.duoarea === 'NUS',
            unit: ['MBBL','Thousand Barrels','thousand barrels','Million Barrels'].includes(x.units) ? x.units : 'unrecognized or missing',
            period:/^\d{4}-\d{2}-\d{2}$/.test(x.period || '') ? x.period : 'unrecognized',
            stock: /^\d+$/.test(String(x.value)) && Number.isSafeInteger(Number(x.value)) ? Number(x.value) : null
          }));
        }
      } catch { diagnostic.validJSON = false; }
    }
    return r;
  };
}
function summarize(id,r) {
  return {indicator:id,series:r.source.series,observationPeriod:r.observationPeriod,actual:r.actual,previous:r.previous,unit:r.unit,adjustment:r.calculation.adjustment,publicationDate:r.publicationDate,publicationStatus:r.publicationStatus,inputPeriods:r.calculation.inputs.map(x=>x.period),checks:'source, units, dates, evidence and arithmetic validated'};
}
async function main() {
  const before = ['economic-data.json','historical-data.json'].map(file=>fs.readFileSync(path.join(root,'data',file),'utf8'));
  let failed = false;
  try {
    const data = await B.collect({fetcher:makeFetcher('BLS')});
    const entries=[];
    for(const family of ['cpi','ppi']) {
      try {
        const now=Date.now();const records=B.familyRecords(data.parsed,family,now);
        for(const [id,r] of Object.entries(records)) {D.validateRecord(r,id,now);entries.push(summarize(id,r));}
      } catch {failed=true;entries.push({family,status:'FAIL',error:'Published series, complete comparable periods, index precision or arithmetic validation failed'});}
    }
    report.providers.BLS={status:entries.every(x=>x.status!=='FAIL')?'PASS':'FAIL',endpoint:'BLS Public Data API v1 (keyless)',attempts:observations.BLS,indicators:entries};
  } catch {failed=true;report.providers.BLS={status:'FAIL',attempts:observations.BLS,error:'BLS HTTP/access/quota/response validation failure; no raw errors logged'};}
  if (!key || !key.trim()) {failed=true;report.providers.EIA={status:'FAIL',error:'EIA_API_KEY secret unavailable; no key was printed'};}
  else try {
    const r=await E.collect({key,fetcher:makeFetcher('EIA')});D.validateRecord(r,'oil',Date.now());
    report.providers.EIA={status:'PASS',endpoint:'EIA API v2 petroleum/stoc/wstk',attempts:observations.EIA,indicators:[summarize('oil',r)]};
  } catch {failed=true;report.providers.EIA={status:'FAIL',attempts:observations.EIA,error:'EIA HTTP/access/quota/source/unit/date/arithmetic validation failure; key and raw errors suppressed'};}
  const after=['economic-data.json','historical-data.json'].map(file=>fs.readFileSync(path.join(root,'data',file),'utf8'));
  report.productionSnapshotsUnchanged=before.every((s,i)=>s===after[i]);
  if(!report.productionSnapshotsUnchanged)failed=true;
  report.limitations=['Observation period is not publication date; BLS/EIA publication timestamps stay blank when absent.','First live fetch cannot independently establish historical revision status.','Consensus forecasts are unavailable from these official time-series APIs and remain blank.','EIA official weekly stock observations are estimates; inventory change is derived from comparable levels.'];
  const output=JSON.stringify(report,null,2);
  // Even an unusual provider response cannot echo a credential through an allowlisted diagnostic.
  if(key && output.includes(key))throw Error('Sensitive content suppressed');
  console.log('LIVE_SMOKE_REPORT_BEGIN\n'+output+'\nLIVE_SMOKE_REPORT_END');
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Read-only live API smoke test\n\n```json\n'+output+'\n```\n');
  if(failed)process.exitCode=1;
}
main().catch(()=>{console.error('Smoke harness failed safely; no raw exception, response or credential printed.');process.exitCode=1;});
