import { describe, expect, it } from "vitest";
import {
  buildLaunchAgentPlist,
  buildServiceEnvironment,
  buildServiceProgramArgs,
  buildSystemdUserService,
  buildWindowsTaskRunCommand,
  SERVICE_LABEL,
  WINDOWS_TASK_NAME,
} from "../src/core/service/serviceManager.js";

describe("serviceManager", () => {
  it("builds persistent service args through up without daemonizing inside the service manager", () => {
    const args = buildServiceProgramArgs(
      {
        engine: "claude",
        port: "60017",
        host: "127.0.0.1",
        cwd: "/tmp/work",
        approve: "deny",
        lanproxySsl: "false",
      },
      { nodePath: "/usr/local/bin/node", cliPath: "/opt/nuwa-cli/dist/cli.js" },
    );

    expect(args).toEqual([
      "/usr/local/bin/node",
      "/opt/nuwa-cli/dist/cli.js",
      "up",
      "--engine",
      "claude",
      "--port",
      "60017",
      "--host",
      "127.0.0.1",
      "--cwd",
      "/tmp/work",
      "--approve",
      "deny",
      "--lanproxy-ssl",
      "false",
    ]);
    expect(args).not.toContain("--daemon");
  });

  it("keeps sensitive environment variables out of generated service environments", () => {
    const env = buildServiceEnvironment(
      {
        PATH: "/usr/local/bin:/usr/bin",
        HOME: "/home/alice",
        NUWACLI_PASSWORD: "pw",
        ANTHROPIC_API_KEY: "sk-secret",
        USER: "alice",
      },
      "linux",
    );

    expect(env).toMatchObject({
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/alice",
      USER: "alice",
      NUWACLI_SERVICE: "1",
    });
    expect(JSON.stringify(env)).not.toContain("pw");
    expect(JSON.stringify(env)).not.toContain("sk-secret");
  });

  it("generates a macOS LaunchAgent plist for the current user", () => {
    const plist = buildLaunchAgentPlist(
      { engine: "codex", port: "60016" },
      {
        nodePath: "/opt/homebrew/bin/node",
        cliPath: "/Users/alice/bin/nuwa-cli.js",
        env: { PATH: "/opt/homebrew/bin:/usr/bin", NUWACLI_PASSWORD: "pw" },
        cwd: "/Users/alice/project",
      },
    );

    expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<string>/opt/homebrew/bin/node</string>");
    expect(plist).toContain("<string>up</string>");
    expect(plist).toContain("<string>codex</string>");
    expect(plist).not.toContain("pw");
  });

  it("generates a systemd user service with restart and process-group cleanup", () => {
    const service = buildSystemdUserService(
      { engine: "claude", cwd: "/home/alice/work repo" },
      {
        nodePath: "/usr/bin/node",
        cliPath: "/home/alice/.local/bin/nuwa-cli.js",
        env: { PATH: "/usr/bin", HOME: "/home/alice", ANTHROPIC_API_KEY: "sk" },
        cwd: "/home/alice",
      },
    );

    expect(service).toContain("Description=Nuwa CLI headless agent");
    expect(service).toContain('ExecStart="/usr/bin/node"');
    expect(service).toContain('"up"');
    expect(service).toContain("Restart=always");
    expect(service).toContain("KillMode=control-group");
    expect(service).not.toContain("sk");
  });

  it("generates a Windows scheduled task command without embedding secrets", () => {
    const command = buildWindowsTaskRunCommand(
      { engine: "claude", cwd: "C:\\Users\\alice\\work repo" },
      {
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        cliPath:
          "C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\nuwa-cli\\dist\\cli.js",
      },
    );

    expect(WINDOWS_TASK_NAME).toBe("NuwaCLI");
    expect(command).toContain('"C:\\Program Files\\nodejs\\node.exe"');
    expect(command).toContain(" up ");
    expect(command).toContain("--engine claude");
    expect(command).not.toContain("savedKey");
    expect(command).not.toContain("password");
  });
});
