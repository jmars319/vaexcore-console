export async function setupUiJavaScriptSource(text) {
  const loaderSource = await text("/ui/app.js");
  const chunkPaths = [...loaderSource.matchAll(/"\/ui\/([^"]+\.js)"/g)].map(
    (match) => `/ui/${match[1]}`,
  );
  const chunkSources = await Promise.all(chunkPaths.map((path) => text(path)));
  return [loaderSource, ...chunkSources].join("\n");
}
