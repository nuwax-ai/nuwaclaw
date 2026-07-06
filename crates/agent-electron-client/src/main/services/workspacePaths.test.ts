import { describe, expect, it } from "vitest";
import * as path from "path";
import {
  resolveComputerProjectWorkspaceDir,
  resolveWorkspacePrefix,
  resolveAgentServerPaths,
} from "./workspacePaths";

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

describe("resolveWorkspacePrefix", () => {
  it("无占位符时原样返回", () => {
    expect(resolveWorkspacePrefix("tsx", "/tmp/base")).toBe("tsx");
  });

  it("替换占位符并统一路径分隔符", () => {
    // 服务器端下发 Linux 正斜杠路径，替换后应统一为当前平台分隔符
    const result = resolveWorkspacePrefix(
      "{PREFIX_WORKSPACE_DIR}/1553045/node_modules/.bin/tsx",
      path.join("/tmp", "base", "user1"),
    );
    expect(result).toBe(
      path.normalize(
        path.join("/tmp", "base", "user1", "1553045/node_modules/.bin/tsx"),
      ),
    );
  });

  it("替换 env 中的占位符", () => {
    const result = resolveWorkspacePrefix(
      "{PREFIX_WORKSPACE_DIR}/1553045/.logs",
      path.join("/tmp", "base"),
    );
    expect(result).toBe(
      path.normalize(path.join("/tmp", "base", "1553045/.logs")),
    );
  });
});

describe("resolveAgentServerPaths", () => {
  it("统一 command 和 args 中的路径分隔符", () => {
    const prefix = path.join("D:", "mycomputer", "workspace", "user1");
    const result = resolveAgentServerPaths(
      "{PREFIX_WORKSPACE_DIR}/1553045/node_modules/.bin/tsx",
      ["{PREFIX_WORKSPACE_DIR}/1553045/src/index.ts"],
      prefix,
    );

    expect(result.command).toBe(
      path.normalize(path.join(prefix, "1553045/node_modules/.bin/tsx")),
    );
    expect(result.args).toEqual([
      path.normalize(path.join(prefix, "1553045/src/index.ts")),
    ]);
  });

  it("无占位符时不做替换", () => {
    const result = resolveAgentServerPaths("tsx", ["src/index.ts"], "/tmp");
    expect(result.command).toBe("tsx");
    expect(result.args).toEqual(["src/index.ts"]);
  });

  it("command/args 为 undefined 时透传", () => {
    const result = resolveAgentServerPaths(undefined, undefined, "/tmp");
    expect(result.command).toBeUndefined();
    expect(result.args).toBeUndefined();
  });
});
