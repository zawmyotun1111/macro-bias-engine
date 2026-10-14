"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const read = (p) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", p), "utf8"));
require("../macro-data.js").validateSnapshot(read("data/economic-data.json"));
require("../providers/fred.cjs").validateHistory(
  read("data/historical-data.json"),
);
require("./update-data.cjs").configValid(read("config/providers.json"));
console.log(
  "Official economic snapshot, historical cache and provider configuration validated.",
);
