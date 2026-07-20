import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  archiveFlowagentsSessions,
  restoreFlowagentsSessions,
} from "./flowagentsSessionPersistence";

describe("flowagentsSessionPersistence", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flowagents-persist-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("archives and restores .flowagents/sessions tree", () => {
    const isolated = path.join(tmp, "iso");
    const project = path.join(tmp, "proj");
    const sessionFile = path.join(
      isolated,
      ".flowagents",
      "sessions",
      "abc",
      "sess_test.json",
    );
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, '{"hello":true}');

    archiveFlowagentsSessions(isolated, project);
    fs.rmSync(isolated, { recursive: true, force: true });

    const newIsolated = path.join(tmp, "iso2");
    restoreFlowagentsSessions(newIsolated, project);

    expect(
      fs.readFileSync(
        path.join(
          newIsolated,
          ".flowagents",
          "sessions",
          "abc",
          "sess_test.json",
        ),
        "utf8",
      ),
    ).toBe('{"hello":true}');
  });
});
