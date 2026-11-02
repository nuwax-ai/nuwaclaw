const ANSI_RE = /\x1b\[[0-9;]*m/g;
const VITE_ERROR_RE = /error|failed|FAIL|ECONNREFUSED/i;

/** @param {string} line */
export function shouldKeepDevLogLine(line) {
  const clean = line.replace(ANSI_RE, "").trimEnd();
  if (!clean) return false;

  if (clean.startsWith("[0]")) {
    const body = clean.slice(3).trimStart();
    return VITE_ERROR_RE.test(body);
  }

  return true;
}

/** @param {string} line */
export function normalizeDevLogLine(line) {
  return line.replace(ANSI_RE, "").trimEnd();
}
