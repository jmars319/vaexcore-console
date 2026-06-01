import { existsSync, readFileSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
};

export const setupShellHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>vaexcore console</title>
    <link rel="icon" href="/ui/logo.jpg" />
    <link rel="stylesheet" href="/ui/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/ui/app.js"></script>
  </body>
</html>`;

export const giveawayOverlayHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>vaexcore giveaway overlay</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #050711;
        --panel: rgba(13, 16, 32, 0.92);
        --panel-soft: rgba(18, 22, 42, 0.88);
        --line: rgba(138, 174, 255, 0.18);
        --cyan: #39d9ff;
        --magenta: #ff3bf4;
        --violet: #8f5cff;
        --text: #f4f8ff;
        --muted: #aeb8d4;
        --amber: #ffd27a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          linear-gradient(135deg, rgba(57, 217, 255, 0.08), transparent 25%),
          linear-gradient(225deg, rgba(255, 59, 244, 0.07), transparent 25%),
          linear-gradient(180deg, rgba(143, 92, 255, 0.08), transparent 40%),
          var(--bg);
        color: var(--text);
      }
      .overlay {
        width: 1920px;
        height: 1080px;
        transform-origin: top left;
        padding: 56px;
        display: grid;
        grid-template-columns: 1.45fr 0.9fr;
        grid-template-rows: auto 1fr auto;
        gap: 24px;
      }
      .hero, .panel {
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
        border-radius: 8px;
      }
      .hero {
        grid-column: 1 / -1;
        padding: 34px 38px;
        position: relative;
      }
      .hero::before {
        position: absolute;
        inset: 0 0 auto;
        height: 3px;
        content: "";
        background: linear-gradient(90deg, var(--cyan), var(--magenta));
      }
      h1 {
        margin: 0 0 12px;
        font-size: 58px;
        line-height: 1;
        letter-spacing: 0;
      }
      .prize {
        margin: 0;
        color: var(--muted);
        font-size: 28px;
      }
      .panel {
        padding: 28px;
        min-width: 0;
      }
      .status-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 18px;
        margin-bottom: 24px;
      }
      .metric {
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 20px;
      }
      .label {
        color: var(--muted);
        font-size: 18px;
        margin-bottom: 8px;
      }
      .value {
        font-size: 34px;
        font-weight: 750;
      }
      .winner {
        min-height: 365px;
        display: grid;
        place-items: center;
        text-align: center;
        background:
          radial-gradient(circle at 50% 42%, rgba(57, 217, 255, 0.16), transparent 34%),
          var(--panel-soft);
        border: 1px solid rgba(57, 217, 255, 0.22);
        border-radius: 8px;
      }
      .winner-name {
        font-size: 72px;
        font-weight: 800;
        text-shadow: 0 0 24px rgba(57, 217, 255, 0.26);
      }
      .winner-state {
        color: var(--amber);
        font-size: 24px;
        margin-top: 14px;
      }
      .spinner {
        width: 138px;
        height: 138px;
        border: 3px solid rgba(57, 217, 255, 0.22);
        border-top-color: var(--cyan);
        border-right-color: var(--magenta);
        border-radius: 50%;
        animation: spin 1.8s linear infinite;
        margin: 0 auto 24px;
      }
      .drawing .spinner { display: block; }
      .spinner { display: none; }
      @keyframes spin { to { transform: rotate(360deg); } }
      h2 {
        margin: 0 0 18px;
        font-size: 28px;
      }
      ul {
        margin: 0;
        padding-left: 23px;
        display: grid;
        gap: 11px;
        color: var(--muted);
        font-size: 20px;
        line-height: 1.28;
      }
      .source {
        display: grid;
        gap: 14px;
        color: var(--muted);
        font-size: 22px;
      }
      .source strong { color: var(--text); }
      .footer {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }
      .note {
        color: var(--muted);
        font-size: 21px;
        line-height: 1.35;
      }
    </style>
  </head>
  <body>
    <main class="overlay" id="overlay">
      <section class="hero">
        <h1 id="title">Giveaway</h1>
        <p class="prize" id="prize">Waiting for giveaway config</p>
      </section>
      <section class="panel">
        <div class="status-grid">
          <div class="metric"><div class="label">Status</div><div class="value" id="status">Closed</div></div>
          <div class="metric"><div class="label">Countdown</div><div class="value" id="countdown">--:--</div></div>
          <div class="metric"><div class="label">Entrants</div><div class="value" id="entrants">0</div></div>
        </div>
        <div class="winner" id="winnerPanel">
          <div>
            <div class="spinner"></div>
            <div class="winner-name" id="winnerName">No winner yet</div>
            <div class="winner-state" id="winnerState">Entries not drawn</div>
          </div>
        </div>
      </section>
      <section class="panel">
        <h2>Rules</h2>
        <ul id="rules"></ul>
      </section>
      <section class="footer">
        <div class="panel source">
          <div><strong id="marketplace">Marketplace: Eneba</strong></div>
          <div id="marketplaceNote">Key purchased after winner confirms platform/region.</div>
          <div>Not sponsored. No affiliate link.</div>
        </div>
        <div class="panel">
          <h2>Platform Availability</h2>
          <div class="note" id="platformNote">Prize availability depends on platform, region, and legitimate purchasable key availability.</div>
          <div class="note" id="responseTimer" style="margin-top:18px;">Response timer starts after draw.</div>
        </div>
      </section>
    </main>
    <script>
      const overlay = document.getElementById("overlay");
      let lastWinnerKey = "";
      function scaleOverlay() {
        const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
        overlay.style.transform = "scale(" + scale + ")";
      }
      window.addEventListener("resize", scaleOverlay);
      scaleOverlay();
      function mmss(ms) {
        if (!ms) return "--:--";
        const seconds = Math.max(0, Math.ceil(ms / 1000));
        return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
      }
      function statusLabel(summary) {
        if (!summary || summary.status === "none") return "Closed";
        if (summary.operatorState === "ready to draw") return "Drawing Ready";
        if (summary.pendingConfirmationCount > 0) return "Winner Pending";
        if (summary.confirmedWinnerCount > 0) return "Confirmed";
        if (summary.expiredWinnerCount > 0) return "Reroll Ready";
        return summary.status === "open" ? "Open" : summary.status === "closed" ? "Closed" : "Rerolled";
      }
      async function refresh() {
        const response = await fetch("/api/giveaway/overlay", { cache: "no-store" });
        const data = await response.json();
        const summary = data.summary || {};
        const config = summary.config || {};
        const winner = data.latestWinner;
        document.getElementById("title").textContent = summary.title || "Giveaway";
        document.getElementById("prize").textContent = [config.gameName, config.itemEdition].filter(Boolean).join(" - ") || config.itemName || "Prize";
        document.getElementById("status").textContent = statusLabel(summary);
        document.getElementById("countdown").textContent = mmss(summary.timer?.remainingMs || 0);
        document.getElementById("entrants").textContent = String(data.entrantCount || 0);
        document.getElementById("marketplace").textContent = "Marketplace: " + (data.marketplace?.name || "Eneba");
        document.getElementById("marketplaceNote").textContent = data.marketplace?.note || "Key purchased after winner confirms platform/region.";
        document.getElementById("platformNote").textContent = data.platformNote || "";
        document.getElementById("responseTimer").textContent = summary.responseTimer?.winnerLogin
          ? "Response timer: " + mmss(summary.responseTimer.remainingMs || 0)
          : "Response timer starts after draw.";
        const rules = document.getElementById("rules");
        rules.replaceChildren(...(data.rules || []).slice(0, 8).map((rule) => {
          const li = document.createElement("li");
          li.textContent = rule;
          return li;
        }));
        const key = winner ? winner.login + ":" + winner.drawnAt + ":" + winner.status : "";
        if (key && key !== lastWinnerKey) {
          document.getElementById("winnerPanel").classList.add("drawing");
          setTimeout(() => document.getElementById("winnerPanel").classList.remove("drawing"), 1400);
          lastWinnerKey = key;
        }
        document.getElementById("winnerName").textContent = winner?.displayName || "No winner yet";
        document.getElementById("winnerState").textContent = winner ? winner.status.replace(/_/g, " ") : "Entries not drawn";
      }
      refresh();
      setInterval(refresh, 1000);
    </script>
  </body>
</html>`;

export const sendHtml = (response: ServerResponse, html: string) => {
  response.writeHead(200, {
    ...securityHeaders,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
};

export const sendPlatformHtml = (response: ServerResponse, html: string) => {
  response.writeHead(200, {
    ...securityHeaders,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src https://player.twitch.tv https://www.twitch.tv; connect-src 'self'; img-src 'self' data: https:",
  });
  response.end(html);
};

export const sendStaticUiAsset = (
  response: ServerResponse,
  pathname: string,
) => {
  const fileName = pathname.replace(/^\/ui\//, "");

  if (!/^[a-z0-9.-]+$/i.test(fileName)) {
    sendText(response, 404, "Not found");
    return;
  }

  const filePath = resolveSetupUiAssetPath(fileName);

  if (!filePath) {
    sendText(response, 404, "Not found");
    return;
  }

  const contentType = getStaticUiAssetContentType(filePath);

  response.writeHead(200, {
    ...securityHeaders,
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(readFileSync(filePath));
};

const getStaticUiAssetContentType = (filePath: string) => {
  switch (extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
};

export const getSetupUiDir = () => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const bundledPath = join(currentDir, "setup-ui");
  const sourcePath = join(currentDir, "ui");

  return existsSync(bundledPath) ? bundledPath : sourcePath;
};

export const getSharedAssetDir = () => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "..", "..", "assets");
};

export const resolveSetupUiAssetPath = (fileName: string) => {
  const setupPath = join(getSetupUiDir(), fileName);

  if (existsSync(setupPath)) {
    return setupPath;
  }

  const sharedAssetPath = join(getSharedAssetDir(), fileName);
  return existsSync(sharedAssetPath) ? sharedAssetPath : undefined;
};

export const sendText = (
  response: ServerResponse,
  status: number,
  text: string,
) => {
  response.writeHead(status, {
    ...securityHeaders,
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
};

export const redirect = (response: ServerResponse, location: string) => {
  response.writeHead(302, { ...securityHeaders, Location: location });
  response.end();
};
