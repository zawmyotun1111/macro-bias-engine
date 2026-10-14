"use strict";
(function () {
  const D = window.MacroData,
    ids = Object.keys(D.definitions),
    $ = (id) => document.getElementById(id);
  let snapshot = D.emptySnapshot(),
    manual = false,
    forecastMode = false,
    busy = false;
  const forecasts = {},
    verifiedManual = {};
  function active(id) {
    return verifiedManual[id] || snapshot.indicators[id];
  }
  function inputMode() {
    for (const id of ids)
      for (const suffix of ["", "_f", "_p"])
        $(id + suffix).readOnly = !(
          manual ||
          (suffix === "_f" && forecastMode)
        );
    $("manualOverride").textContent = manual
      ? "Use Verified Data"
      : "Manual Override";
    $("manualForecasts").textContent = forecastMode
      ? "Clear Manual Forecasts"
      : "Manual Forecasts";
    $("clearData").disabled = !manual;
    $("dataMode").textContent = manual
      ? "MANUAL OVERRIDE — unverified scenario inputs; refresh will not replace them."
      : forecastMode
        ? "Official actuals + MANUAL FORECAST estimates (unverified consensus). Forecasts are session-only and tied to the displayed observation period."
        : "Official BLS/EIA actuals. ISM needs user-verified manual entry. Consensus forecasts stay blank without a licensed feed.";
  }
  function applyValues() {
    for (const id of ids) {
      const r = active(id);
      $(id).value = r.actual ?? "";
      $(id + "_p").value = r.previous ?? "";
      if (forecasts[id] && forecasts[id].period !== r.observationPeriod)
        delete forecasts[id];
      $(id + "_f").value = forecasts[id]?.value ?? "";
    }
  }
  function recalculate() {
    analyzeV2();
    $("btcMacroBias").textContent =
      $("bias").textContent + " | score " + $("score").textContent;
    $("goldMacroBias").textContent = $("btcMacroBias").textContent;
    const usable = ids.filter((id) => active(id).status === "released").length;
    $("biasDataStatus").textContent = manual
      ? "Calculated from manual, unverified inputs."
      : `Calculated from ${usable}/${ids.length} available releases${forecastMode ? " with unverified manual forecast estimates" : ""}. BTC and Gold share V1; V2 retains your asset and D1 inputs.`;
    if (!manual && !usable) {
      $("btcMacroBias").textContent = $("goldMacroBias").textContent =
        "Unavailable — no verified releases";
      $("score").textContent = "—";
      $("bias").textContent = "No verified economic data";
    }
  }
  function date(v) {
    return v
      ? new Date(v).toLocaleString(undefined, { timeZoneName: "short" })
      : "— (not provided by the API)";
  }
  function renderMetadata() {
    const box = $("releaseMetadata");
    box.replaceChildren();
    let stale = 0,
      missing = 0;
    for (const id of ids) {
      const r = active(id),
        status = D.freshness(r, id);
      if (status === "stale") stale++;
      if (status === "unavailable") missing++;
      const row = document.createElement("div");
      row.className = "release-row";
      const title = document.createElement("strong");
      title.textContent =
        D.definitions[id].name +
        " — " +
        status +
        (r.collectionMethod === "manual-verified"
          ? " | user-verified manual"
          : "");
      row.append(title);
      const detail = document.createElement("div");
      detail.className = "note";
      detail.textContent = `Observation: ${r.observationPeriod || "—"} | Publication: ${date(r.publicationDate)} | Fetched/verified: ${date(r.fetchedAt)} | Last successful ${r.collectionMethod === "manual-verified" ? "user verification" : "API check"}: ${date(r.lastSuccessfulUpdate)} | Revision: ${r.revision?.status || "unknown"}`;
      row.append(detail);
      if (r.source) {
        const link = document.createElement("a");
        link.href = D.officialURL(r.source.url, D.definitions[id].host);
        link.textContent = r.source.name;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        row.append(
          link,
          document.createTextNode(
            " | " +
              r.source.provider +
              " | " +
              (r.source.series || "Services survey"),
          ),
        );
      } else
        row.append(
          document.createTextNode("Source: — | No verified release available"),
        );
      row.append(
        document.createTextNode(
          forecasts[id]
            ? " | Forecast: manual consensus estimate (unverified)"
            : " | Forecast unavailable; consensus estimate only",
        ),
      );
      if (r.calculation)
        row.append(
          document.createTextNode(
            " | " +
              r.calculation.adjustment +
              " | Derived from published " +
              r.calculation.inputUnit +
              " levels",
          ),
        );
      box.append(row);
      $(id).parentElement.dataset.freshness = status;
      $(id).parentElement.title =
        `${status} | observation ${r.observationPeriod || "—"}`;
    }
    $("staleWarning").hidden = !stale && !missing;
    $("staleWarning").textContent =
      `${stale} stale and ${missing} unavailable indicators. Bias may be incomplete or outdated. Missing values stay blank; retained stale values remain visible.`;
  }
  async function refreshData() {
    if (busy) return;
    busy = true;
    $("refreshData").disabled = true;
    $("refreshStatus").textContent = "Checking published snapshot…";
    try {
      const response = await fetch(
        "./data/economic-data.json?t=" + Date.now(),
        { cache: "no-store" },
      );
      if (!response.ok) throw Error("Fetch failed");
      const next = D.validateSnapshot(await response.json());
      if (
        snapshot.generatedAt &&
        (!next.generatedAt || next.generatedAt < snapshot.generatedAt)
      )
        throw Error("Older snapshot");
      for (const id of ids) {
        const old = snapshot.indicators[id],
          r = next.indicators[id];
        if (
          old.observationPeriod &&
          (!r.observationPeriod ||
            r.observationPeriod < old.observationPeriod ||
            r.lastSuccessfulUpdate < old.lastSuccessfulUpdate)
        )
          throw Error("Older observation");
      }
      snapshot = next;
      if (!manual) {
        applyValues();
        recalculate();
      }
      renderMetadata();
      $("refreshStatus").textContent =
        "Published snapshot: " +
        date(snapshot.generatedAt) +
        (manual ? " | Manual inputs kept." : " | Bias recalculated.") +
        " | No new official release was triggered.";
    } catch {
      $("refreshStatus").textContent =
        "Refresh failed. Last verified data retained; check connection and GitHub Actions.";
    } finally {
      busy = false;
      $("refreshData").disabled = false;
    }
  }
  function clearForecasts() {
    for (const id of ids) delete forecasts[id];
    forecastMode = false;
    if (manual) for (const id of ids) $(id + "_f").value = "";
    else applyValues();
    inputMode();
    renderMetadata();
    recalculate();
  }
  $("refreshData").addEventListener("click", refreshData);
  $("manualOverride").addEventListener("click", () => {
    manual = !manual;
    inputMode();
    if (!manual) applyValues();
    renderMetadata();
    recalculate();
  });
  $("manualForecasts").addEventListener("click", () => {
    if (forecastMode) clearForecasts();
    else {
      forecastMode = true;
      inputMode();
      recalculate();
    }
  });
  $("clearData").addEventListener("click", () => {
    if (manual) {
      for (const id of ids)
        for (const suffix of ["", "_f", "_p"]) $(id + suffix).value = "";
      recalculate();
    }
  });
  $("analyzeMacro").addEventListener("click", recalculate);
  $("runV2").addEventListener("click", recalculate);
  $("saveVerifiedISM").addEventListener("click", () => {
    try {
      const id = $("manualIndicator").value;
      D.requireCondition(
        ["ism", "prices", "employment"].includes(id) &&
          $("verifiedConfirm").checked,
        "Check the official report and confirmation box",
      );
      D.requireCondition(
        $("verifiedActual").value.trim() !== "",
        "Actual is required",
      );
      const actual = D.numeric(
          Number($("verifiedActual").value),
          D.definitions[id],
        ),
        previous =
          $("verifiedPrevious").value.trim() === ""
            ? null
            : D.numeric(Number($("verifiedPrevious").value), D.definitions[id]);
      const publicationDate = new Date(
          $("verifiedPublication").value,
        ).toISOString(),
        now = new Date().toISOString();
      const r = {
        ...D.emptyRecord(id),
        actual,
        previous,
        status: "released",
        observationPeriod: $("verifiedPeriod").value,
        publicationDate,
        publicationStatus: "confirmed",
        fetchedAt: now,
        lastSuccessfulUpdate: now,
        source: {
          name: "Official ISM Services report (checked by user)",
          provider: "Manual verification",
          series: null,
          url: D.officialURL($("verifiedSource").value, "ismworld.org"),
        },
        collectionMethod: "manual-verified",
        revision: { status: "unknown", detectedAt: null },
      };
      D.validateRecord(r, id);
      if (verifiedManual[id])
        D.requireCondition(
          r.observationPeriod >= verifiedManual[id].observationPeriod,
          "Do not replace a newer verified release",
        );
      verifiedManual[id] = r;
      if (!manual) applyValues();
      renderMetadata();
      recalculate();
      $("manualEntryStatus").textContent =
        "User-verified manual release applied locally. It will not be published or attributed to an API update.";
    } catch {
      $("manualEntryStatus").textContent =
        "Manual entry rejected. Check actual/previous, month, past publication time, official source URL and confirmation.";
    }
  });
  for (const id of ids)
    for (const suffix of ["", "_f", "_p"]) {
      const el = $(id + suffix);
      el.placeholder = "";
      el.type = "number";
      el.step = "any";
      el.setAttribute(
        "aria-label",
        D.definitions[id].name +
          " " +
          { "": "Actual", _f: "Forecast consensus estimate", _p: "Previous" }[
            suffix
          ],
      );
      el.addEventListener("input", () => {
        if (!manual && suffix === "_f" && forecastMode) {
          try {
            const r = active(id);
            D.requireCondition(
              r.observationPeriod,
              "A verified observation period is required before adding its forecast",
            );
            const value =
              el.value.trim() === ""
                ? null
                : D.numeric(Number(el.value), D.definitions[id]);
            if (value === null) delete forecasts[id];
            else forecasts[id] = { period: r.observationPeriod, value };
          } catch {
            el.value = "";
            delete forecasts[id];
            $("manualEntryStatus").textContent =
              "Forecast rejected: use a valid estimate tied to an available observation period.";
          }
          renderMetadata();
        }
        if (manual || forecastMode) recalculate();
      });
    }
  inputMode();
  renderMetadata();
  refreshData();
  setInterval(renderMetadata, 60000);
  setInterval(refreshData, 15 * 60000);
})();
