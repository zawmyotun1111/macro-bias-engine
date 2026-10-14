"use strict";
const { requireCondition } = require("../macro-data.js");
async function requestJSON(
  url,
  options = {},
  fetcher = fetch,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      const r = await fetcher(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      requireCondition(r.ok, "Request failed");
      const body = await r.text();
      requireCondition(body.length < 5000000, "Oversized response");
      return JSON.parse(body);
    } catch {
      if (attempt === 2)
        throw Error(
          "Official provider request failed; check credentials, quota and network",
        );
      await pause(1000 * (attempt + 1));
    }
}
module.exports = { requestJSON };
