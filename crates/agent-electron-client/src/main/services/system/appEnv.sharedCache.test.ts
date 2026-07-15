import { describe, it, expect, vi } from "vitest";

// appEnv → binaryLocator 会拉 electron；单测只覆盖纯函数，mock 掉即可
vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp",
    isPackaged: false,
  },
}));

import {
  applySharedPackageManagerCacheEnv,
  SHARED_PACKAGE_MANAGER_CACHE_ENV_KEYS,
} from "./appEnv";

describe("applySharedPackageManagerCacheEnv", () => {
  it("rewrites shared package cache keys after HOME/XDG isolation", () => {
    const appEnv: Record<string, string> = {
      NPM_CONFIG_CACHE: "/appdata/npm-cache",
      PNPM_HOME: "/appdata/pnpm/global",
      PNPM_STORE_DIR: "/appdata/pnpm/store",
      PNPM_CACHE_DIR: "/appdata/pnpm/cache",
      PNPM_STATE_DIR: "/appdata/pnpm/state",
      UV_CACHE_DIR: "/appdata/uv/cache",
      UV_TOOL_DIR: "/appdata/uv/tools",
      UV_TOOL_BIN_DIR: "/appdata/uv/tools/bin",
      UV_PYTHON_INSTALL_DIR: "/appdata/uv/python",
    };

    // 模拟 HOME/XDG 重定向后可能被清掉或落到 isolated home 的状态
    const env: Record<string, string> = {
      HOME: "/run/projects/u1/p1/home",
      XDG_CACHE_HOME: "/run/projects/u1/p1/home/.cache",
      NPM_CONFIG_CACHE: "/run/projects/u1/p1/home/.npm",
      PNPM_CACHE_DIR: "/run/projects/u1/p1/home/.cache/pnpm",
    };

    applySharedPackageManagerCacheEnv(env, appEnv);

    for (const key of SHARED_PACKAGE_MANAGER_CACHE_ENV_KEYS) {
      expect(env[key]).toBe(appEnv[key]);
    }
    // HOME / XDG 隔离语义保持不变
    expect(env.HOME).toBe("/run/projects/u1/p1/home");
    expect(env.XDG_CACHE_HOME).toBe("/run/projects/u1/p1/home/.cache");
  });

  it("skips missing keys in appEnv", () => {
    const env: Record<string, string> = { PNPM_CACHE_DIR: "old" };
    applySharedPackageManagerCacheEnv(env, { PNPM_STORE_DIR: "/shared/store" });
    expect(env.PNPM_STORE_DIR).toBe("/shared/store");
    expect(env.PNPM_CACHE_DIR).toBe("old");
  });

  it("includes UV_PYTHON_INSTALL_DIR so uv python is not installed under project HOME", () => {
    expect(SHARED_PACKAGE_MANAGER_CACHE_ENV_KEYS).toContain(
      "UV_PYTHON_INSTALL_DIR",
    );
  });
});
