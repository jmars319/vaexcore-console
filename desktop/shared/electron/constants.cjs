const setupPort = 3434;
const setupUrl = `http://localhost:${setupPort}`;
const setupProbeUrl = `http://127.0.0.1:${setupPort}/api/config`;
const setupStatusUrl = `http://127.0.0.1:${setupPort}/api/status`;
const productName = "vaexcore console";
const legacyProductName = "VaexCore";
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const vaexcoreSuiteApps = [
  "vaexcore studio",
  "vaexcore pulse",
  "vaexcore console",
];

const isPackagedBootSmoke = () =>
  process.env.VAEXCORE_PACKAGED_BOOT_SMOKE === "1";

module.exports = {
  isMac,
  isPackagedBootSmoke,
  isWindows,
  legacyProductName,
  productName,
  setupPort,
  setupProbeUrl,
  setupStatusUrl,
  setupUrl,
  vaexcoreSuiteApps,
};
