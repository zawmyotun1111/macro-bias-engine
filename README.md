# Macro Bias Engine — official-source-first data

PR #1 preserves V1/V2, Burmese/English UI, D1/market/Fed inputs, position sizing and the installable PWA. Trading Economics is no longer a production dependency. No subscription, merge, deployment, secret configuration or scheduled-job activation has been performed.

The committed snapshots are deliberately blank. Synthetic fixtures are used only by tests. Official data must pass validation before publication.

## Coverage and automation

| Indicator                                   | Actual / Previous                                                      | Exact source series                  | Publication metadata                                                                      | Consensus Forecast          |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------- |
| CPI m/m                                     | Automated from BLS index levels                                        | `CUSR0000SA0`, SA                    | Partly automated: API fetch/check times; publication time needs official release evidence | Blank; manual session entry |
| CPI y/y                                     | Automated from BLS index levels                                        | `CUUR0000SA0`, NSA                   | Same                                                                                      | Same                        |
| Core CPI m/m                                | Automated from BLS index levels                                        | `CUSR0000SA0L1E`, SA                 | Same                                                                                      | Same                        |
| Core CPI y/y                                | Automated from BLS index levels                                        | `CUUR0000SA0L1E`, NSA                | Same                                                                                      | Same                        |
| PPI m/m                                     | Automated from BLS final-demand index                                  | `WPSFD4`, SA                         | Same                                                                                      | Same                        |
| Core PPI m/m                                | Automated: final demand less foods/energy                              | `WPSFD49104`, SA                     | Same                                                                                      | Same                        |
| Crude inventories                           | Automated: consecutive U.S. commercial weekly stocks **excluding SPR** | EIA `WCESTUS1`, NSA                  | Partly automated; exact publication time not supplied by stock observations               | Same                        |
| ISM Services PMI / Prices Paid / Employment | **Verified manual entry only**, with official-report evidence          | Services survey, never manufacturing | Enter observation month, publication time and report URL; confirm verification            | Same                        |

“Automated” describes implemented collectors after approved activation, not an already-running production service. Full released-rate automation is implemented for seven displayed fields. Exact publication metadata remains partly manual; ISM and forecasts remain manual. No licensed consensus source is configured.

## Calculation and integrity

Monthly inflation changes use seasonally adjusted levels. CPI annual changes use unadjusted levels for the same month a year earlier. Core PPI here means **less foods and energy**, not the distinct less-foods-energy-and-trade-services measure. Source mappings follow [BLS CPI series IDs](https://www.bls.gov/cpi/factsheets/cpi-series-ids.htm) and [BLS PPI FD–ID series definitions](https://www.bls.gov/ppi/fd-id/ppi-final-demand-intermediate-demand-aggregation-indexes-by-title-and-series-id.htm).

The calculation is `(index[t] / index[t-lag] - 1) × 100`, with lag 1 for m/m and 12 for y/y. Published decimal levels are converted to exact scaled integers. Only the final rate is rounded to one decimal, with half ties away from zero; index levels are never rounded early. See [BLS percent-change methodology](https://www.bls.gov/cpi/factsheets/calculating-percent-changes.htm). The JSON includes the source levels, dates, seasonal adjustment, lag, method and output precision. These are **derived rates from published official index levels**, not a claim to have retrieved an independently published rate field.

Previous is recalculated for `t-1` using the same fetched index vintage, including any revisions. An incomplete latest observation or missing denominator/prior-rate history rejects the entire related CPI/PPI family; it cannot substitute an older observation or manufacture a Previous value. CPI's four fields must share one latest observation month; the two PPI fields must also share one month. CPI and PPI are independently accepted, because their publication schedules differ.

[EIA WCESTUS1](https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WCESTUS1&f=W) is U.S. ending stocks excluding the Strategic Petroleum Reserve, reported in thousand barrels. The v2 adapter requests `petroleum/stoc/wstk`, frequency `weekly`, series `WCESTUS1`, and validates product `EPC0`, process `SAX`, area `NUS`, and units `MBBL`. It computes `(stock[t] - stock[t-1])/1000` in **million barrels**; Previous uses `(stock[t-1] - stock[t-2])/1000`. Three consecutive Friday observations are required. Never substitute SPR-inclusive stocks, Cushing-only stocks, API petroleum estimates, nonweekly observations or daily flow units.

Missing is always `null`/blank; zero is a real rate, never a placeholder. Denominator zero, malformed values, mismatched series/periods/units, future or duplicate observations, unexpected fields and impossible dates fail validation. The public validator recomputes every automated rate/change from its evidence. Output fields are explicitly allowlisted and checked for credential leakage before atomic replacement.

A failed provider/family retains its entire last verified record, including original fetch/check timestamps and evidence. Other valid families can update. If all enabled official collectors fail and optional historical fallback produces nothing, collection fails with no data writes. Disabled providers also retain their existing data. Stale retained actuals continue contributing to bias with a visible warning.

## Observation, publication, fetch and revision are separate

Schema v2 records these distinctly:

- `observationPeriod`: the index month (`YYYY-MM`) or inventory week ending (`YYYY-MM-DD`).
- `publicationDate`: a confirmed official release timestamp, otherwise **null**. An API observation period is not its publication date.
- `fetchedAt`: successful retrieval/validation time in UTC. It is not a release time.
- `lastSuccessfulUpdate`: last successful official API validation; unchanged on provider failure. For local ISM entries, the dashboard explicitly calls this a **user verification** time.
- `revision.status`: `first-seen`, `unchanged`, `revised`, or `unknown`; changes in overlapping raw evidence detect revisions even if the displayed rounded rate is unchanged. `detectedAt` is our detection time, not a fabricated official revision timestamp.

BLS/EIA time-series responses do not reliably identify the exact initial publication timestamp for each returned observation. The default publication field stays blank, labelled “not provided by the API”. Optional reviewed metadata can be entered in `config/publications.json`, keyed by family and observation period. Each entry must include `observationPeriod`, `publicationDate` (UTC), and `sourceURL` on the original official host. Match the period in a released official bulletin; do not copy a scheduled future calendar date. The empty committed manifest contains no invented dates.

`first-seen` does not mean “unrevised” or “final”. BLS seasonally adjusted CPI can be revised when factors are recalculated; [BLS describes this annual revision process](https://www.bls.gov/cpi/seasonal-adjustment/). PPI revisions and preliminary flags are retained in raw evidence. Comparing the stored calculation inputs detects changes affecting the displayed Actual/Previous; it is not a full historical revision archive.

Freshness checks run every minute. More than 36 hours without a successful check triggers a warning. When publication metadata exists, releases older than 45 days (CPI/PPI), 40 days (ISM), or 10 days (oil) also warn. Without publication metadata, the fallback age uses observation periods: 75 days for monthly indicators and 14 days for oil. These are conservative age checks, not evidence of a scheduled-but-missing release. Weekend warnings are intentional.

## Modular providers and optional FRED history

`config/providers.json` enables BLS and EIA separately and leaves FRED disabled. Modules are in `providers/`, with shared sanitized HTTP/retry and revision handling. BLS uses one batched request for all six index series and the last three calendar years. EIA uses one ten-observation request per run. No ISM website requests are made by collectors.

If explicitly enabled and **neither CPI nor PPI family can validate**, FRED can populate `data/historical-data.json` as an optional historical fallback. It never substitutes for current official actuals, modifies the trading snapshot, fills Forecast, or advances BLS's last-success time. This avoids concealing FRED release lag during an official API outage.

The FRED mapping is `CPIAUCSL`, `CPIAUCNS`, `CPILFESL`, `CPILFENS`, `WPSFD4`, `WPSFD49104`. Series frequency/seasonal adjustment and release family are checked. Requests specify one UTC as-of date for `realtime_start`/`realtime_end`; incomplete/truncated/mismatched vintage responses are rejected. Only completed months strictly before the month containing the configured cutoff are accepted; `minimumLagDays` must be at least 45. Changed historical levels are explicitly marked revised.

FRED's `releaseCalendarDate` is separately labelled metadata; it is **not** treated as the publication date for an individual historical observation or proof of FRED availability at that instant. Historical `publicationDate` stays blank. The output is labelled `notForTrading`. See [FRED vintage semantics](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html), [observations API](https://fred.stlouisfed.org/docs/api/fred/series_observations.html), and [release dates](https://fred.stlouisfed.org/docs/api/fred/release_dates.html).

## ISM access investigation and licensing

No reliable, publicly documented and permitted free machine-readable ISM Services API was identified. [ISM's terms](https://www.ismworld.org/footer/terms-of-use/) prohibit automated collection and restrict reproduction of their content. Public HTML/PDF access does not establish permission to scrape or redistribute it. Therefore no scraper, hidden endpoint, paid subscription, FRED ISM substitute or licensed feed is implemented.

Use **Verified manual ISM entry** only after personally checking the official services report. Enter Actual, optional Previous, observation month, past publication time and an official report URL, then confirm the check. It is labelled **user-verified manual**, not API-verified. It lives only in the browser session and is never committed or published. Numerical/source/date validation verifies the entry's structure, not the truth of a human attestation. Public redistribution of ISM data requires separate written permission; manual entry does not remove that requirement.

BLS numeric data is [public domain](https://www.bls.gov/opub/copyright-information.htm), with exceptions for protected visual material. EIA permits reuse of its government data with attribution; [its reuse policy](https://www.eia.gov/about/copyrights_reuse.php) also identifies protected third-party materials. The application retains agency attribution and confirmed publication dates when available. FRED is an aggregator: [its API terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html) and underlying source terms both apply. Only the mapped BLS historical series are requested; no ISM licensing shortcut is assumed.

## API registration, limits and costs

No paid data subscription is required by this implementation.

| Provider               | Secret                          | Registration                                                                      | Limits relevant to this collector                                     |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| BLS v1                 | None                            | Keyless public endpoint                                                           | 25 queries/day, 25 series/query, 10 years/query                       |
| BLS v2                 | `BLS_API_KEY`, optional         | [Free BLS registration](https://data.bls.gov/registrationEngine/); renew annually | 500 queries/day, 50 series/query, 20 years/query                      |
| EIA v2                 | `EIA_API_KEY`, required for oil | [Free EIA key](https://www.eia.gov/opendata/register.php)                         | JSON maximum 5,000 rows; this collector requests 10                   |
| FRED, optional history | `FRED_API_KEY`                  | [FRED API-key registration](https://fred.stlouisfed.org/docs/api/api_key.html)    | Up to 120 requests/minute; enabled fallback makes 24 sequential calls |

The [BLS FAQ](https://www.bls.gov/developers/api_faqs.htm) also lists 50 requests per 10 seconds. [EIA guidance](https://www.eia.gov/opendata/faqs.php) gives approximate sustained/burst ceilings of 9,000/hour and fewer than 5/second, subject to request complexity and throttling. [FRED documents 429 responses](https://fred.stlouisfed.org/docs/api/fred/errors.html). Collectors use 20-second request timeouts, reject redirects, and retry at most three times with pauses. Failure logs never include keys, request URLs or provider bodies.

Four scheduled runs per weekday use normally **four BLS + four EIA calls/day**, or about 88 calls per provider in a 22-weekday month. All retry attempts count toward limits; manual runs share the same quotas. Keyless BLS can consume up to 12 attempts/day from scheduled runs in a failure scenario. FRED adds requests only when enabled and both BLS families fail. Standard hosted Actions in public repositories and public GitHub Pages are available without an additional subscription, subject to [Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [Pages](https://docs.github.com/en/pages/getting-started-with-github-pages) rules. No purchase has been made.

Add keys only through **Settings → Secrets and variables → Actions → Secrets**. No keys belong in provider JSON, HTML, issues, PRs, screenshots or commits. `GITHUB_TOKEN` is automatically supplied for the data-only commit; no frontend token or personal access token is needed.

## Dashboard controls and trading models

**Refresh Data** loads the newest already-published JSON with `cache: no-store`. It explicitly states that it does **not** trigger a new official release or an API collection. Maintainers can use the linked Actions workflow's **Run workflow** after activation approval. The open app checks published snapshots every 15 minutes.

**Manual Forecasts** unlocks only Forecast fields while Actual/Previous remain locked. Forecasts are visibly unverified consensus estimates, tied to the displayed observation period. Same-period refresh retains them; a new observation period clears them. Without a verified observation period, the forecast entry is rejected. No forecast is persisted, publicly distributed, guessed from Previous, or described as an official actual.

**Manual Override** permits a visibly unverified scenario using arbitrary economic inputs. **Use Verified Data** restores official/user-verified records and any period-matched forecast overlays. **Clear Manual Data** clears scenario economic values only; D1/risk inputs remain intact. ISM user-verified entries and forecast overlays stay in the browser session, are not stored across reloads, and are never sent to GitHub.

A verified snapshot refresh recalculates BTC/Gold V1 macro bias and the selected V2 setup, retaining asset, D1, Fed, market confirmation and risk inputs. V1 remains the same shared heuristic for BTC and Gold. Missing Forecast removes only the surprise component; available Previous trends, employment/PMI/oil logic and market confirmation still apply. Lack of all actuals is shown as unavailable, not a verified zero.

PWA assets and offline data remain cached. Economic JSON uses a single canonical cache key despite timestamped requests; validation failures never replace it with HTML. Original successful-check timestamps stay intact offline. Schema v2 and a new service-worker cache version separate official-source data from the earlier calendar prototype.

## Approval-only rollout and rollback

The existing PR branch continues; no new PR or production branch is created. Tests run on branch pushes and PRs without API secrets. The collection job still requires **main** plus `AUTO_DATA_UPDATES_ENABLED=true`; Pages publication requires main plus `PAGES_DEPLOYMENT_ENABLED=true`. Both activation variables remain untouched. Merging into an existing branch-based Pages source could publish outside those workflow guards; review the current Pages configuration before an approved merge.

After explicit owner approval, register the free keys, confirm provider responses/source mapping with a real smoke test, review publication metadata, then merge and activate collection. The cron `17 13,15,17,19 * * 1-5` is UTC: 19:47, 21:47, 23:47, and 01:47 the next local date in Myanmar. BLS monthly and EIA weekly releases have independent schedules; holidays, API lag and GitHub scheduling delays are expected. This is periodic economic context, not a low-latency event-trading feed. EIA notes that its embargoed weekly releases have [special processing](https://www.eia.gov/opendata/faqs.php).

For approved Pages activation, configure Pages' source to GitHub Actions, enable its variable, and dispatch the Pages workflow. `workflow_run` publishes after successful collection because a data commit made with `GITHUB_TOKEN` does not trigger another push workflow. Only public PWA assets and validated JSON are staged; provider scripts, configuration, test fixtures and secrets are excluded. Optional historical cache has its own `notForTrading` label.

To stop collection, unset/set false `AUTO_DATA_UPDATES_ENABLED`; disable an individual provider in reviewed configuration to retain its last data. To stop this publisher, unset/set false `PAGES_DEPLOYMENT_ENABLED`. These switches do not unpublish an existing site or control older branch-based Pages settings. To roll back after approved deployment, disable collection first, revert the approved code/data change on main or restore a reviewed validated official snapshot, then publish that reviewed version. Never replace missing data with demo values or reintroduce the retired paid calendar payload as official schema v2 data.

## Tests and remaining blockers

Node 22+ has no npm runtime dependencies:

```sh
npm test
npm run validate-data
python3 -m pip install playwright==1.62.0
python3 scripts/browser-test.py
```

Python/Playwright tests use an installed Chromium/Google Chrome and a temporary localhost server. They serve a blank bootstrap independent of future production snapshots and never fetch an economic provider or change public data.

The prior **27 Node regression tests** remain covered: 9 trading-model tests and 4 service-worker tests execute production code; the 14 retired calendar-contract tests execute an isolated, frozen fixture under `tests/fixtures/legacy/`. That fixture has no CLI/write path, is never imported by production, and is excluded from Pages. It preserves the earlier data-integrity regressions without keeping a paid production provider. New official-provider tests exercise the actual v2 collectors/validators. One new trading test explicitly verifies blank-Forecast scoring. The original 17 browser scenarios are rerun against v2 with updated official-schema fixtures; nine additional checks cover forecast-only mode, period changes and verified manual ISM.

Remaining rollout blockers: EIA/FRED keys are not configured; authenticated provider smoke tests have not been run. This managed environment's current egress policy excludes the official API hosts, so live keyless BLS testing also remains pending. Official documentation and synthetic payload tests were used; no synthetic payload is published. Exact BLS/EIA publication metadata is unavailable by default until reviewed release evidence is supplied. ISM automation remains unavailable without a permitted feed; public redistribution rights are not assumed. These limitations are reported before any deployment approval request.
