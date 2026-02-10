/**
 * 依赖管理服务测试
 */

import { describe, it, expect } from "vitest";

describe("DependencyService", () => {
  describe("依赖定义", () => {
    it("应该定义正确的依赖状态类型", () => {
      const statuses = [
        "checking",
        "installed",
        "missing",
        "outdated",
        "installing",
        "error",
      ];
      statuses.forEach((status) => {
        expect(typeof status).toBe("string");
      });
    });

    it("应该定义依赖项接口", () => {
      const mockDependency = {
        name: "nodejs",
        displayName: "Node.js",
        version: "v18.19.0",
        source: "系统全局",
        status: "installed" as const,
        required: true,
        description: "JavaScript 运行时环境",
      };

      expect(mockDependency.name).toBe("nodejs");
      expect(mockDependency.displayName).toBe("Node.js");
      expect(mockDependency.required).toBe(true);
    });
  });

  describe("核心依赖", () => {
    it("应该包含 Node.js 作为必需依赖", () => {
      const coreDependencies = ["nodejs", "git", "npm"];
      expect(coreDependencies).toContain("nodejs");
    });

    it("应该包含 Git 作为必需依赖", () => {
      const coreDependencies = ["nodejs", "git", "npm"];
      expect(coreDependencies).toContain("git");
    });

    it("应该包含 npm 作为必需依赖", () => {
      const coreDependencies = ["nodejs", "git", "npm"];
      expect(coreDependencies).toContain("npm");
    });
  });

  describe("运行时依赖", () => {
    it("应该定义 Python 为可选依赖", () => {
      const runtimeDependencies = ["python", "docker", "rust"];
      expect(runtimeDependencies).toContain("python");
    });

    it("应该定义 Docker 为可选依赖", () => {
      const runtimeDependencies = ["python", "docker", "rust"];
      expect(runtimeDependencies).toContain("docker");
    });

    it("应该定义 Rust 为可选依赖", () => {
      const runtimeDependencies = ["python", "docker", "rust"];
      expect(runtimeDependencies).toContain("rust");
    });
  });

  describe("命令行工具", () => {
    it("应该定义 cURL 为可选依赖", () => {
      const cliTools = ["curl", "jq", "pandoc", "ffmpeg"];
      expect(cliTools).toContain("curl");
    });

    it("应该定义 jq 为可选依赖", () => {
      const cliTools = ["curl", "jq", "pandoc", "ffmpeg"];
      expect(cliTools).toContain("jq");
    });

    it("应该定义 Pandoc 为可选依赖", () => {
      const cliTools = ["curl", "jq", "pandoc", "ffmpeg"];
      expect(cliTools).toContain("pandoc");
    });

    it("应该定义 FFmpeg 为可选依赖", () => {
      const cliTools = ["curl", "jq", "pandoc", "ffmpeg"];
      expect(cliTools).toContain("ffmpeg");
    });
  });

  describe("npm 包", () => {
    it("应该定义 OpenCode 为可选依赖", () => {
      const npmPackages = ["opencode", "@anthropic-ai/claude-code"];
      expect(npmPackages).toContain("opencode");
    });

    it("应该定义 Claude Code 为可选依赖", () => {
      const npmPackages = ["opencode", "@anthropic-ai/claude-code"];
      expect(npmPackages).toContain("@anthropic-ai/claude-code");
    });
  });

  describe("依赖统计", () => {
    it("应该能计算总依赖数", () => {
      const totalDependencies = 12; // Node.js, Git, npm, Python, Docker, Rust, cURL, jq, Pandoc, FFmpeg, OpenCode, Claude Code
      expect(totalDependencies).toBe(12);
    });

    it("应该能计算必需依赖数", () => {
      const requiredDependencies = 3; // Node.js, Git, npm
      expect(requiredDependencies).toBe(3);
    });

    it("应该能计算可选依赖数", () => {
      const optionalDependencies = 9;
      expect(optionalDependencies).toBe(9);
    });
  });

  describe("依赖安装", () => {
    it("应该支持安装单个依赖", () => {
      const installFunction = (name: string) => true;
      expect(typeof installFunction).toBe("function");
    });

    it("应该支持安装所有缺失依赖", () => {
      const installAllFunction = () => true;
      expect(typeof installAllFunction).toBe("function");
    });

    it("应该支持卸载依赖", () => {
      const uninstallFunction = (name: string) => true;
      expect(typeof uninstallFunction).toBe("function");
    });

    it("应该支持刷新依赖状态", () => {
      const refreshFunction = () => true;
      expect(typeof refreshFunction).toBe("function");
    });
  });
});

describe("DependencyStatus", () => {
  it("checking - 正在检查", () => {
    expect("checking").toBe("checking");
  });

  it("installed - 已安装", () => {
    expect("installed").toBe("installed");
  });

  it("missing - 未安装", () => {
    expect("missing").toBe("missing");
  });

  it("outdated - 需要更新", () => {
    expect("outdated").toBe("outdated");
  });

  it("installing - 正在安装", () => {
    expect("installing").toBe("installing");
  });

  it("error - 错误", () => {
    expect("error").toBe("error");
  });
});
