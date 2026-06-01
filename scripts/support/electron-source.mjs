import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function electronMainSource() {
  const directory = resolve("desktop/shared/electron");
  return readdirSync(directory)
    .filter((file) => file.endsWith(".cjs"))
    .sort()
    .map((file) => readFileSync(resolve(directory, file), "utf8"))
    .join("\n");
}
