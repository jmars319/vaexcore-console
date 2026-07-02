const setupUiScripts = [
  "/ui/app-00.js",
  "/ui/app-01.js",
  "/ui/app-02.js",
  "/ui/app-03.js",
  "/ui/app-04.js",
  "/ui/app-05.js",
  "/ui/app-06-timers.js",
  "/ui/app-07-moderation.js",
  "/ui/app-07.js",
  "/ui/app-08.js",
  "/ui/app-09.js",
  "/ui/app-10.js",
  "/ui/app-12-settings-hosted.js",
  "/ui/app-13-setup-guide.js",
  "/ui/app-12.js",
  "/ui/app-13.js",
  "/ui/app-14.js",
  "/ui/app-15.js",
  "/ui/app-16.js",
  "/ui/app-17.js",
  "/ui/app-18.js",
  "/ui/app-19.js",
  "/ui/app-20.js",
  "/ui/app-24-diagnostics-actions.js",
  "/ui/app-25-form-sync.js",
  "/ui/app-26-provider-ops.js",
  "/ui/app-27-operator-safety.js",
  "/ui/app-22.js",
  "/ui/app-23.js",
];

window.__VAEXCORE_SETUP_UI_PARTS__ = setupUiScripts.slice();

const loadSetupUiScript = (src) =>
  new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error(`Unable to load setup UI script: ${src}`));
    document.head.appendChild(script);
  });

(async () => {
  try {
    for (const src of setupUiScripts) await loadSetupUiScript(src);
  } catch (error) {
    console.error(error);
    const app = document.getElementById("app");
    if (app) {
      app.innerHTML =
        '<main class="shell"><section class="card danger"><h2>Setup UI failed to load</h2><p>Reload vaexcore console. If this continues, run the setup smoke check.</p></section></main>';
    }
  }
})();
