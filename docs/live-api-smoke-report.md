# Live BLS/EIA smoke test — passed

The [read-only GitHub Actions run](https://github.com/zawmyotun1111/macro-bias-engine/actions/runs/38607743141) completed successfully against PR #1 provider commit `2b1738d5ff5dcf4adba490ce22863e9040c086cc`. Test start: 2026-10-14T17:34:16.776Z (15 October 2026, 00:04 Myanmar time).

The diagnostic harness is on the separate trusted branch [codex/live-api-smoke](https://github.com/zawmyotun1111/macro-bias-engine/tree/codex/live-api-smoke). PR #1 and main were unchanged. Main remains `d293b02bacb69fe0e223e0bd876844f2924bc4d2`.

## Results

BLS public v1 returned HTTP 200 and REQUEST_SUCCEEDED in one request. All six source series, monthly observation periods, family-period consistency, seasonal adjustment mappings, full-precision index ratios, Previous calculations and public record validation passed.

EIA API v2 returned HTTP 200 in one request using EIA_API_KEY inside Actions only. Ten weekly records returned. The exact WCESTUS1/EPC0/SAX/NUS/MBBL mapping, weekly frequency, observation dates, positive stock levels, consecutive comparable weeks and calculated Actual/Previous changes passed.

| Field | Source series | Observation period | Derived Actual | Derived Previous | Unit | Adjustment |
| --- | --- | --- | --- | --- | --- | --- |
| ccpi_m | CUSR0000SA0L1E | 2026-09 | 0.3 | 0.3 | % | SA |
| ccpi_y | CUUR0000SA0L1E | 2026-09 | 2.6 | 2.4 | % | NSA |
| cpi_m | CUSR0000SA0 | 2026-09 | 0.6 | 0.4 | % | SA |
| cpi_y | CUUR0000SA0 | 2026-09 | 3.7 | 3.4 | % | NSA |
| cppi_m | WPSFD49104 | 2026-08 | 0.2 | 0.3 | % | SA |
| ppi_m | WPSFD4 | 2026-08 | 0.4 | 0.1 | % | SA |
| oil | WCESTUS1 | 2026-10-02 | -3.186 | 0.922 | million barrels | NSA |

Inflation rates are derived from published official index levels and rounded to one decimal only at the end. They are not consensus forecasts.

EIA source levels were 424,134 thousand barrels (2026-10-02), 427,320 (2026-09-25), and 426,398 (2026-09-18). Actual = (424134 - 427320)/1000 = **−3.186 million barrels**. Previous = (427320 - 426398)/1000 = **+0.922 million barrels**. These are U.S. commercial crude stocks excluding SPR; the weekly stock observations themselves are official estimates.

No HTTP or validation errors occurred. Both production JSON snapshots were byte-for-byte unchanged; both checkout git-diff checks passed. The accompanying dashboard validation runs passed as well.

## Missing metadata and source limitations

- Exact publication timestamps were absent for all seven returned fields and stayed null/unknown. The test never substituted observation dates, fetch time, or calendar schedules.
- A single live fetch cannot establish whether historical values have been revised. The production collector compares subsequent fetched evidence with retained verified evidence; that revision comparison was covered by regression tests, not independently proven by this one-shot live run.
- Official APIs do not supply consensus forecasts; all remain blank.
- FRED was not tested and remains an optional disabled historical fallback.
- ISM remains user-verified manual entry; this test makes no ISM requests.

The returned CPI September / PPI August / EIA week ending October 2 periods are consistent with the official schedules at test time. [BLS schedules September PPI for October 15 at 08:30 Eastern](https://www.bls.gov/schedule/2026/10_sched.htm), equivalent to **October 15, 19:00 Myanmar time**. [EIA schedules the October 9 inventory week for October 15 at 12:00 Eastern because of Columbus Day](https://www.eia.gov/petroleum/supply/weekly/schedule.php), equivalent to **October 15, 22:30 Myanmar time**. Calendar entries establish scheduled timing only, not confirmed publication timestamps for API rows.

## Security and safe manual reruns

The production collection workflow was not used: it is gated to main and includes snapshot commits. The secretless PR validation workflow was also not modified to receive secrets.

The diagnostic workflow:
- runs only for the explicit owner actor and the exact repository/trusted diagnostic branch;
- has contents: read, no Pages/id-token/write permissions, no schedule and no pull_request_target;
- uses pinned checkout/setup-node action commits, disables persisted checkout credentials, and checks out the exact reviewed PR provider commit;
- gives EIA_API_KEY only to the request step; never prints the key, raw provider bodies, credential-bearing request URLs or raw exceptions;
- performs no snapshot writes, commits, deployment or production activation.

To manually rerun the already registered run, the owner can use Actions → this run → Re-run all jobs, or:

```sh
gh run rerun 38607743141 --repo zawmyotun1111/macro-bias-engine
```

A workflow_dispatch trigger is included in the diagnostic file. GitHub requires that a dispatch workflow exist on the default branch before it can receive manual dispatch events ([GitHub documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)). Main was not modified to register it because an existing branch-based Pages setup could publish main changes.

If a permanent dispatch-only method is desired, separately review/approve registration of a test-only default-branch workflow under a deployment-safe process, retain the owner/repository/branch guards and pinned provider SHA, remove the push trigger, and dispatch it with:

```sh
gh workflow run live-smoke.yml --ref codex/live-api-smoke --repo zawmyotun1111/macro-bias-engine
```

That command is a proposal after approved default-branch registration, not a command claimed to work under the present main configuration. Do not grant secrets to untrusted PR code or relax fork/security policies.

## Exact next steps for deployment approval

1. Review PR #1 at the tested commit and this successful live report. Decide whether unknown publication timestamps are acceptable or require reviewed official release metadata before launch.
2. Review the current Pages publishing source and branch protection without changing them. Confirm the approved merge/activation sequence so a merge cannot unintentionally publish through an existing branch-based Pages configuration.
3. Obtain explicit owner approval identifying separately: merge PR #1, activate production collection, and deploy/configure GitHub Pages. None of these permissions is inferred from authorization to smoke-test.
4. Only after that approval: merge the reviewed PR, keep EIA_API_KEY in Actions Secrets, optionally add a free BLS_API_KEY for higher quotas, and set AUTO_DATA_UPDATES_ENABLED=true when production collection is approved. Run collection manually on main and review validated JSON/metadata.
5. Only after deployment/settings approval: configure Pages for the approved source, enable PAGES_DEPLOYMENT_ENABLED=true, and run the Pages publisher. Confirm actuals/blank forecasts, stale warnings, manual ISM/forecast labels and offline PWA behavior.
6. Keep FRED disabled unless separately configured/tested. If either production provider fails, retain verified records rather than fabricating missing values.

No merge, auto-update activation, Pages setting change or deployment was performed.
