/**
 * Filter noisy dev console output before writing logs/electron-dev.log.
 *
 * Usage (repo root): npm run dev 2>&1 | node scripts/dev/electron-dev-log.mjs ../../logs/electron-dev.log
 */
import fs from "node:fs";
import {
  normalizeDevLogLine,
  shouldKeepDevLogLine,
} from "./electron-dev-log-filter.mjs";

const outPath = process.argv[2];
if (!outPath) {
  console.error("Usage: node scripts/dev/electron-dev-log.mjs <output-log-path>");
  process.exit(1);
}

const out = fs.createWriteStream(outPath, { flags: "a" });

/** @param {string} line */
function emit(line) {
  const clean = normalizeDevLogLine(line);
  if (!shouldKeepDevLogLine(clean)) return;
  const normalized = `${clean}\n`;
  process.stdout.write(normalized);
  out.write(normalized);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    emit(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => {
  if (buffer.length > 0) emit(buffer);
  out.end();
});
