// Synthetic published-level payloads, never used in production output.
const D = require("../../macro-data.js");
const now = Date.parse("2026-10-14T18:00:00Z");
function bls() {
  return {
    status: "REQUEST_SUCCEEDED",
    Results: {
      series: Object.values(D.definitions)
        .filter((d) => d.host === "bls.gov")
        .map((d) => ({
          seriesID: d.series,
          data: Array.from({ length: 15 }, (_, i) => {
            const p = D.shiftMonth("2026-09", -i);
            return {
              year: p.slice(0, 4),
              period: "M" + p.slice(5),
              value: String(d.adjustment === "SA" ? 300 + i : 400 + i),
              footnotes: [],
            };
          }),
        })),
    },
  };
}
function eia() {
  return {
    response: {
      frequency: "weekly",
      data: ["2026-10-09", "2026-10-02", "2026-09-25"].map((period, i) => ({
        period,
        series: "WCESTUS1",
        product: "EPC0",
        process: "SAX",
        duoarea: "NUS",
        units: "MBBL",
        value: String(430000 + i * 1400),
      })),
    },
  };
}
function response(value) {
  return { ok: true, status: 200, text: async () => JSON.stringify(value) };
}
module.exports = { bls, eia, now, response };
