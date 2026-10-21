const path = require("node:path");

require("./node-user-info-shim.cjs");

const shimPath = path.resolve(__dirname, "node-user-info-shim.cjs");
const preloadOption = `--require=${JSON.stringify(shimPath)}`;
if (!process.env.NODE_OPTIONS?.includes(shimPath)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, preloadOption].filter(Boolean).join(" ");
}

import("tsx/cli").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
