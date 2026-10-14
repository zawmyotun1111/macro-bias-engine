# Macro Bias Engine — automatic US economic data

The original Burmese/English V1 and V2 dashboard, D1 structure controls, cross-market/Fed inputs, position sizing, and installable PWA are retained. Validated economic releases now come from a server-side GitHub Actions job. GitHub Pages serves static public assets and a credential-free JSON snapshot.

**Review branch only: no merge, deployment, provider subscription, secret creation, or production activation has been performed.** The shipped snapshot is deliberately blank. A real licensed provider run must succeed before economic values appear.

## Data provider, keys and costs

The implemented adapter uses **Trading Economics Economic Calendar API**. One credential, stored as the repository Actions secret `TRADING_ECONOMICS_API_KEY`, covers the calendar. Enter the credential in the exact format issued by Trading Economics (often `client:secret`). No BLS, EIA, FRED, OpenAI, frontend token, or personal GitHub token is required by this implementation.

| Dashboard field | Exact provider event | Original release source | Output unit |
| --- | --- | --- | --- |
| CPI m/m, y/y | Inflation Rate MoM / Inflation Rate YoY | US Bureau of Labor Statistics | percentage points |
| Core CPI m/m, y/y | Core Inflation Rate MoM / Core Inflation Rate YoY | US Bureau of Labor Statistics | percentage points |
| PPI m/m, Core PPI m/m | PPI MoM / Core PPI MoM | US Bureau of Labor Statistics | percentage points |
| ISM Services PMI | ISM Services PMI | Institute for Supply Management | index points |
| ISM Prices Paid | ISM Services Prices | Institute for Supply Management, **services** survey | index points |
| ISM Employment | ISM Services Employment | Institute for Supply Management, **services** survey | index points |
| EIA Crude Oil Inventories | EIA Crude Oil Stocks Change | US Energy Information Administration | weekly change in **million barrels** |

ISM manufacturing, S&P services, API petroleum estimates, and EIA Cushing-only inventories are never substituted. Oil is the change in inventories, matching the existing engine, not the absolute stock level. Exact events and official source hosts must match; changed provider naming fails closed and requires an adapter update.

Trading Economics requires an API subscription with US calendar history, consensus fields and the required events enabled. **Confirm public redistribution/display rights for JSON in a public GitHub repository and GitHub Pages**, including ISM data, with the provider before activation. Public commits retain historical snapshots. Pricing varies with features, request volume and distribution; obtain a current quote from the [official pricing page](https://tradingeconomics.com/api/pricing.aspx) and [API overview](https://tradingeconomics.com/analytics/api.aspx). No fixed dollar price is claimed because a current applicable quote could not be verified. Confirm coverage and sample payloads before buying a plan.

The default schedule runs 16 times per weekday; each run makes nine date-window requests over 63 calendar days: approximately **3,168 requests per 22-weekday month**, plus retries and manual runs. Confirm this allowance or reduce the cron frequency for your plan. Standard GitHub-hosted Actions are [free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions), and [GitHub Pages is available for public repositories on GitHub Free](https://docs.github.com/en/pages/getting-started-with-github-pages). Hosting limits and repository plan changes still apply.

Direct [BLS public APIs](https://www.bls.gov/developers/) and the [free EIA API key](https://www.eia.gov/opendata/documentation.php) are possible future alternatives for actual time series. They are **not implemented adapters** here and do not replace the calendar's consensus forecasts or the ISM services feed. Missing forecasts must stay blank even with a paid plan; component-index consensus may be unavailable. No forecast is inferred from Previous or from Trading Economics' own `TEForecast` projection.

## Verification rules

“Verified” in this dashboard means a **released Actual reported by the authenticated calendar provider**, attached to a known official source URL and passing structural validation. It does not mean independently cross-checked against a second live official API. Source links make the original publisher reviewable; provider licensing and live coverage remain prerequisites.

- Use only the US event's `Actual`, `Forecast`, and `Previous` fields from the same release row. `Forecast` is explicitly labelled a **consensus estimate**, never a released fact. The provider's separate `TEForecast` is ignored.
- Preserve missing values as `null` in JSON and blank in inputs; zero is valid. Never generate, backfill, interpolate or copy forecasts from another release period.
- Require a numeric release ID, reference period, exact known timing (`DateSpan=0`), actual release at or before now, official BLS/ISM/EIA source host, and consistent provider revision/check timestamps.
- Convert strict percent/index/million-barrel values; reject unknown units, partial numeric strings, impossible dates, nonfinite/out-of-range values and conflicting duplicates. Range limits are safety bounds, not estimates.
- Apply provider revisions, including the revised `Previous` from that row; do not use the `Revised` field (the value before revision) as Previous. Reject release/revision regression and conflicting release identity.
- An invalid latest release does not refresh an older row's successful-check timestamp. Keep the last validated record unchanged and warn in Actions. Other independently valid indicators can update. If none pass, fail the job and leave the entire file untouched.
- Use bounded seven-day queries and fail if a response reaches the provider's [1,000-row limit](https://docs.tradingeconomics.com/get_started/rate-limits/). Retries are limited and credentials/provider response bodies are never logged. Write the validated snapshot atomically.

The [provider response schema](https://docs.tradingeconomics.com/economic_calendar/schema/) distinguishes consensus `Forecast` from `TEForecast`, describes source fields, revisions and timing precision. The adapter uses the [country/date endpoint](https://docs.tradingeconomics.com/economic_calendar/country/).

## Dashboard behavior

**Refresh Data** fetches the most recently published JSON without an HTTP cache and recalculates V1 BTC/Gold macro bias and the current V2 setup/risk model. The legacy V1 heuristic is shared by BTC and Gold; two displayed labels do not imply separate asset-specific models. Refresh preserves D1, asset, Fed, confirmation and execution inputs. It does not directly request the paid API or dispatch a workflow from the public browser. Use the adjacent GitHub Actions link and **Run workflow** as an authorized maintainer to request a new server fetch.

**Manual Override** unlocks economic inputs for local scenario analysis and explicitly labels calculations unverified. Automatic refresh continues checking the published snapshot but leaves manual inputs intact. **Use Verified Data** restores the latest validated snapshot. **Clear Manual Data** clears only economic values, preserving D1 and risk inputs. Overrides are session-only; they never modify JSON or claim a successful verified update.

Per-indicator metadata displays release time, reference period, source link, provider revision time and last successful verification. API timestamps are normalized to UTC; display uses the user's local timezone and prints the timezone. Last successful verification is a server timestamp, not the time the Refresh button was pressed.

Stale warnings appear after 36 hours without successful verification, or when a release exceeds 45 days for CPI/PPI, 40 days for ISM, or 10 days for oil. The 36-hour rule deliberately warns during weekends; it does not prove a release is wrong. Retained stale values still contribute to bias and are visibly flagged. The app checks freshness every minute and checks published data every 15 minutes while open. Offline PWA snapshots retain their original timestamps; JSON failures never fall back to HTML and timestamped requests share one data cache entry.

The undated “Load Current Example” has been removed from the production UI. Synthetic values exist only in tests and are never copied to the public data snapshot.

## Activation — only after owner approval

These steps are documentation for the approved rollout; the PR does not perform them.

1. Review the PR, test it, confirm provider licensing/coverage and explicitly approve merge and live deployment.
2. Merge the approved code to `main`. Keep both activation variables unset until ready. If Pages currently publishes directly from `main`, merging could publish through that existing configuration; review/change the Pages source before merging when staging is required.
3. In **Settings → Secrets and variables → Actions → Secrets**, create `TRADING_ECONOMICS_API_KEY`. Never paste it into HTML, JSON, a commit, an issue, a PR, screenshots or logs. The workflow alone reads it from `${{ secrets.TRADING_ECONOMICS_API_KEY }}`.
4. In Actions **Variables**, set `AUTO_DATA_UPDATES_ENABLED` to the literal `true` when server updates are approved. Run **Update verified economic data** on **main** and inspect the sanitized validation summary and resulting JSON. Missing secret/access yields a failed run and leaves data unchanged.
5. Configure **Settings → Pages → Source → GitHub Actions** after deployment approval. Set `PAGES_DEPLOYMENT_ENABLED` to `true`, then run **Publish dashboard to GitHub Pages** on main. Optionally require reviewers on the `github-pages` environment to gate deployments.
6. Check the Pages dashboard, source metadata, blank component forecasts, stale flags, both models and install/offline behavior. Only the public PWA asset allowlist is staged; scripts, tests and credentials are excluded from the deployed artifact.

The updater requires `contents: write` for data-only commits to main; all other default permissions are read-only. Branch protection may require a separate data PR strategy or permitted bot; do not bypass your repository's rules. `GITHUB_TOKEN` is supplied automatically by Actions. Commits made with it do not trigger another push workflow; the Pages workflow therefore also listens to successful completion of the updater using `workflow_run`, with its own activation gate. Neither workflow can deploy a PR branch.

The cron is `7,37 12-19 * * 1-5` UTC, covering common US release times in both standard/daylight time. This corresponds to 18:37–02:07 Myanmar time (across the following local date). GitHub schedules can be delayed and may be disabled after extended repository inactivity. This is periodic updating, not a low-latency trading feed. US holidays and publication delays are handled by retaining verified values and showing age warnings.

## Development and tests

Node.js 22+ is sufficient. There are **no npm dependencies** to install.

```sh
npm test
npm run validate-data
python3 -m pip install playwright==1.62.0
python3 scripts/browser-test.py
```

The browser test requires Python 3, Playwright, and Chromium/Google Chrome, creates a temporary local server/profile, and tests the actual dashboard and service worker. It never calls the economic API or changes the committed snapshot. CI runs tests on PRs without provider secrets.

Tests cover strict parsing, source/event identity, blank/zero fields, forecasts, revisions, duplicate conflicts, stale dates, failing/retrying provider requests, V1 weights, V2 cap/grades/D1/cross-market/Fed calculations, long/short position sizing, invalid execution inputs, manual controls, refresh retention and PWA caching.

Four calculation corrections accompany preserved models: missing Previous is no longer coerced to zero; equal forecasts/previous values no longer create a negative surprise for ISM/prices/oil; V2 DXY/Yield directions now match their selector labels; invalid/nonpositive risk inputs and same-side stop/target do not produce a position size. The original complete-demo regression still scores +5.0 in V1 and +15.6 with the original default V2 D1 inputs.

No authenticated economic-provider end-to-end test has been run without a licensed key. Unit tests use explicit synthetic fixtures; initial provider validation is required before production activation. Disable `AUTO_DATA_UPDATES_ENABLED` to stop new data fetches or `PAGES_DEPLOYMENT_ENABLED` to stop this workflow's publishing. These switches do not unpublish the existing site or control an older branch-based Pages configuration.
