import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getOpencodeDataDir,
  snapshotOpencodePersistence,
} from "./opencodeSessionDiagnostics";

describe("opencodeSessionDiagnostics", () => {
  it("getOpencodeDataDir resolves under isolated HOME", () => {
    expect(getOpencodeDataDir("/tmp/iso-home")).toBe(
      path.join("/tmp/iso-home", ".local", "share", "opencode"),
    );
  });

  it("snapshotOpencodePersistence counts session info json files", () => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "iso-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "proj-"));
    const dataDir = getOpencodeDataDir(isolated);
    const infoDir = path.join(dataDir, "storage", "session", "info");
    fs.mkdirSync(infoDir, { recursive: true });
    fs.writeFileSync(path.join(infoDir, "ses_test.json"), "{}");
    fs.writeFileSync(path.join(dataDir, "opencode.db"), "x");

    const snap = snapshotOpencodePersistence(isolated, project);
    expect(snap.opencodeDataExists).toBe(true);
    expect(snap.sessionInfoJsonCount).toBe(1);
    expect(snap.dbFiles).toEqual([{ name: "opencode.db", bytes: 1 }]);

    fs.rmSync(isolated, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });
});
