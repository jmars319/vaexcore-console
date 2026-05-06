# Windows Desktop

Windows-specific desktop files live here.

- `assets/icon.ico` is the Windows app icon generated from `desktop/shared/assets/logo.jpg`.
- `scripts/install-electron-better-sqlite3.mjs` repairs and probes the packaged Windows `better-sqlite3` native module after Electron Builder creates `release/win-unpacked`.

Current Windows entrypoint:

```sh
npm run app:build:windows
```

Run that command on Windows. It builds the shared desktop bundle, packages an unpacked Windows Electron app, installs the Electron ABI prebuild for `better-sqlite3`, and launches the packaged executable in `ELECTRON_RUN_AS_NODE` mode to confirm SQLite opens.

Installer artifact entrypoint:

```sh
npm run app:dist:windows
```

That command builds NSIS and portable Windows artifacts. The Electron Builder `afterPack` hook repairs the packaged `better-sqlite3` native module before installer artifacts are created, then the post-build smoke script probes the unpacked app.

Local Windows paths:

- Suite discovery: `%APPDATA%\vaexcore\suite`
- Console app data and SQLite: Electron `userData`, normally `%APPDATA%\vaexcore console`
- Twitch secrets: app-owned `local.secrets.json` until the Windows Credential Manager migration lands

The app can launch the suite from standard Windows install locations such as `%LOCALAPPDATA%\Programs\<app name>\<app name>.exe`.
