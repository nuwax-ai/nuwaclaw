import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  resolveComputerProjectWorkspaceDir,
  findProjectWorkspaceByProjectId,
  resolveNormalProjectWorkspaceDir,
  findNormalProjectWorkspaceByProjectId,
  resolveAgentProjectDir,
  resolveWorkspacePrefix,
  resolveAgentServerPaths,
} from "./workspacePaths";

const isUsableDir = (dir: string) => {
  try {
    return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

const tempDirs: string[] = [];
function makeTempBase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nuwax-ws-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length) {
    const d = tempDirs.pop();
    if (d) fs.rmSync(d, { recursive: true, force: true });
  }
});

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

describe("findProjectWorkspaceByProjectId", () => {
  it("userId 轨道不对时按 projectId 唯一命中", () => {
    const base = makeTempBase();
    const real = path.join(base, "computer-project-workspace", "6", "1694288");
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, "a.txt"), "x");

    // 精确拼接（userId=local）不存在；按 projectId 反查命中 6/1694288
    expect(findProjectWorkspaceByProjectId(base, "1694288", isUsableDir)).toBe(
      real,
    );
  });

  it("多命中不猜返回 null", () => {
    const base = makeTempBase();
    for (const uid of ["6", "7"]) {
      const d = path.join(base, "computer-project-workspace", uid, "p1");
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "a.txt"), "x");
    }
    expect(findProjectWorkspaceByProjectId(base, "p1", isUsableDir)).toBeNull();
  });

  it("空目录/无命中返回 null", () => {
    const base = makeTempBase();
    const empty = path.join(base, "computer-project-workspace", "6", "p1");
    fs.mkdirSync(empty, { recursive: true });
    expect(findProjectWorkspaceByProjectId(base, "p1", isUsableDir)).toBeNull();
    expect(findProjectWorkspaceByProjectId(base, "missing", isUsableDir)).toBe(
      null,
    );
  });
});

describe("resolveNormalProjectWorkspaceDir", () => {
  it("base workspace 下追加 normalProject 层（镜像云端布局）", () => {
    expect(resolveNormalProjectWorkspaceDir("/tmp/base", "u1", "p1")).toBe(
      path.join(
        "/tmp/base",
        "computer-project-workspace",
        "u1",
        "normalProject",
        "p1",
      ),
    );
  });

  it("已是 normalProject workspace 时不重复追加", () => {
    const projectDir = path.join(
      "/tmp/base",
      "computer-project-workspace",
      "u1",
      "normalProject",
      "p1",
    );

    expect(resolveNormalProjectWorkspaceDir(projectDir, "u1", "p1")).toBe(
      projectDir,
    );
  });

  it("与 agent-runner 布局互不混层", () => {
    const base = "/tmp/base";
    expect(resolveNormalProjectWorkspaceDir(base, "u1", "p1")).not.toBe(
      resolveComputerProjectWorkspaceDir(base, "u1", "p1"),
    );
  });
});

describe("findNormalProjectWorkspaceByProjectId", () => {
  it("userId 轨道不对时按 projectId 唯一命中 normalProject 层", () => {
    const base = makeTempBase();
    const real = path.join(
      base,
      "computer-project-workspace",
      "6",
      "normalProject",
      "p9",
    );
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, "a.txt"), "x");

    expect(findNormalProjectWorkspaceByProjectId(base, "p9", isUsableDir)).toBe(
      real,
    );
  });

  it("不跨层命中 agent-runner 布局的同 projectId 目录", () => {
    const base = makeTempBase();
    const agentRunner = path.join(
      base,
      "computer-project-workspace",
      "6",
      "p9",
    );
    fs.mkdirSync(agentRunner, { recursive: true });
    fs.writeFileSync(path.join(agentRunner, "a.txt"), "x");

    // 只有 agent-runner 层有 p9，normalProject 层没有 → null（不跨层反查）
    expect(
      findNormalProjectWorkspaceByProjectId(base, "p9", isUsableDir),
    ).toBeNull();
  });

  it("多命中不猜返回 null", () => {
    const base = makeTempBase();
    for (const uid of ["6", "7"]) {
      const d = path.join(
        base,
        "computer-project-workspace",
        uid,
        "normalProject",
        "p1",
      );
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "a.txt"), "x");
    }
    expect(
      findNormalProjectWorkspaceByProjectId(base, "p1", isUsableDir),
    ).toBeNull();
  });

  it("空目录/无命中返回 null", () => {
    const base = makeTempBase();
    const empty = path.join(
      base,
      "computer-project-workspace",
      "6",
      "normalProject",
      "p1",
    );
    fs.mkdirSync(empty, { recursive: true });
    expect(
      findNormalProjectWorkspaceByProjectId(base, "p1", isUsableDir),
    ).toBeNull();
    expect(
      findNormalProjectWorkspaceByProjectId(base, "missing", isUsableDir),
    ).toBe(null);
  });
});

describe("resolveAgentProjectDir（三轨目录推导单一事实源）", () => {
  it("normalProject 业务 → normalProject 层", () => {
    expect(
      resolveAgentProjectDir(
        "/tmp/base",
        "u1",
        "42",
        "computer-normal-project",
      ),
    ).toBe(
      path.join(
        "/tmp/base",
        "computer-project-workspace",
        "u1",
        "normalProject",
        "42",
      ),
    );
  });

  it("容器物化形态归一为 pid（service_type 缺失也命中 normalProject 层）", () => {
    expect(
      resolveAgentProjectDir(
        "/tmp/base",
        "u1",
        "/home/user/normalProject/np-9",
      ),
    ).toBe(
      path.join(
        "/tmp/base",
        "computer-project-workspace",
        "u1",
        "normalProject",
        "np-9",
      ),
    );
  });

  it("normalProject + 本机自选绝对目录 → 原值直通（agentWorkspacePath 覆盖场景）", () => {
    expect(
      resolveAgentProjectDir(
        "/tmp/base",
        "u1",
        "/Users/me/x",
        "computer-normal-project",
      ),
    ).toBe("/Users/me/x");
  });

  it("无 service_type 的标识符 → 平铺层（存量行为）", () => {
    expect(resolveAgentProjectDir("/tmp/base", "u1", "c-1")).toBe(
      path.join("/tmp/base", "computer-project-workspace", "u1", "c-1"),
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
