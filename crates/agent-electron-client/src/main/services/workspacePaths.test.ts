import { describe, expect, it } from "vitest";
import * as path from "path";
import { resolveComputerProjectWorkspaceDir } from "./workspacePaths";

describe("resolveComputerProjectWorkspaceDir", () => {
  it("base workspace 下追加 computer project workspace", () => {
    expect(resolveComputerProjectWorkspaceDir("/tmp/base", "u1", "p1")).toBe(
      path.join("/tmp/base", "computer-project-workspace", "u1", "p1"),
    );
  });

  it("已是 project workspace 时不重复追加", () => {
    const projectDir = path.join(
      "/tmp/base",
      "computer-project-workspace",
      "u1",
      "p1",
    );

    expect(resolveComputerProjectWorkspaceDir(projectDir, "u1", "p1")).toBe(
      projectDir,
    );
  });
});
