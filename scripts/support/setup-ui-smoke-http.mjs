export function createSetupUiSmokeHttp({ baseUrl, assert }) {
  async function text(path) {
    const response = await fetch(`${baseUrl}${path}`);
    assert(response.ok, `${path} returned ${response.status}`);
    return response.text();
  }

  async function binary(path) {
    const response = await fetch(`${baseUrl}${path}`);
    assert(response.ok, `${path} returned ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      byteLength: bytes.byteLength,
      contentType: response.headers.get("content-type"),
    };
  }

  async function json(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: options.body
        ? { "Content-Type": "application/json" }
        : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    assert(response.ok, `${path} returned ${response.status}`);
    return response.json();
  }

  async function expectOk(path, body = {}) {
    const result = await json(path, { method: "POST", body });
    assert(result.ok === true, `${path} returns ok`);
    return result;
  }

  async function waitForLaunchPreparation() {
    const deadline = Date.now() + 3000;

    while (Date.now() < deadline) {
      const launch = await json("/api/launch-preparation");

      if (!["pending", "running"].includes(launch.status)) {
        return launch;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error("Smoke failed: launch preparation did not finish");
  }

  return { text, binary, json, expectOk, waitForLaunchPreparation };
}

export async function setupUiStyleSource(text) {
  const entrySource = await text("/ui/styles.css");
  const importPaths = [
    ...entrySource.matchAll(/@import\s+url\("([^"]+)"\);/g),
  ].map((match) => `/ui/${match[1].replace(/^\.\//, "")}`);
  const importedSources = await Promise.all(
    importPaths.map((path) => text(path)),
  );
  return [entrySource, ...importedSources].join("\n");
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function assertSafeConfig(config, assert) {
  const raw = JSON.stringify(config);
  assert(!("clientSecret" in config), "safe config omits clientSecret");
  assert(!("accessToken" in config), "safe config omits accessToken");
  assert(!("refreshToken" in config), "safe config omits refreshToken");
  assert(
    !raw.includes("fake-client-secret"),
    "safe config does not expose saved secret",
  );
}
