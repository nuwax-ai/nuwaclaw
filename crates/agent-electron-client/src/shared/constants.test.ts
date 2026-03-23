/**
 * 单元测试: constants
 *
 * 测试应用常量的完整性和一致性
 */

import { describe, it, expect } from "vitest";
import {
  APP_DISPLAY_NAME,
  APP_NAME_IDENTIFIER,
  APP_DATA_DIR_NAME,
  DEFAULT_MCP_PROXY_PORT,
  DEFAULT_FILE_SERVER_PORT,
  DEFAULT_AGENT_RUNNER_PORT,
  DEFAULT_LANPROXY_PORT,
  DEFAULT_DEV_SERVER_PORT,
  LOCALHOST_IP,
  LOCALHOST_HOSTNAME,
  LOCAL_HOST_URL,
  DEFAULT_ANTHROPIC_API_URL,
  DEFAULT_SERVER_HOST,
  DEFAULT_AI_ENGINE,
  DEFAULT_AI_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MODEL_OPTIONS,
  DEFAULT_API_TIMEOUT,
  DEFAULT_SSE_RETRY_DELAY,
  DEFAULT_SSE_MAX_RETRY_DELAY,
  DEFAULT_SSE_HEARTBEAT_INTERVAL,
  DEFAULT_STARTUP_DELAY,
  CLEANUP_TIMEOUT,
  PROCESS_KILL_ESCALATION_TIMEOUT,
  ACP_ABORT_TIMEOUT,
  ENGINE_DESTROY_TIMEOUT,
  DEPS_SYNC_TIMEOUT,
  NPM_MIRRORS,
  UV_MIRRORS,
  DEFAULT_MIRROR_CONFIG,
  STORAGE_KEYS,
  AUTH_KEYS,
  MSG_SUCCESS,
  MSG_ERROR,
  MSG_WARNING,
  MSG_INFO,
  DEPENDENCY_STATUS_LABELS,
  ACTION_MESSAGES,
  SERVICE_NAMES,
  SERVICE_DESCRIPTIONS,
  AGENT_STATUS_CONFIG,
  SERVICE_STATE_NAMES,
} from "./constants";

describe("Constants", () => {
  describe("App Identity", () => {
    it("should have consistent app name", () => {
      expect(APP_DISPLAY_NAME).toBe("NuwaClaw");
      expect(APP_NAME_IDENTIFIER).toBe("nuwaclaw");
    });

    it("should have app data dir name with dot prefix", () => {
      expect(APP_DATA_DIR_NAME).toBe(".nuwaclaw");
    });
  });

  describe("Port Configuration", () => {
    it("should have valid port numbers", () => {
      expect(DEFAULT_MCP_PROXY_PORT).toBeGreaterThan(0);
      expect(DEFAULT_MCP_PROXY_PORT).toBeLessThan(65536);
      expect(DEFAULT_FILE_SERVER_PORT).toBe(60005);
      expect(DEFAULT_AGENT_RUNNER_PORT).toBe(60006);
      expect(DEFAULT_LANPROXY_PORT).toBe(60002);
      expect(DEFAULT_DEV_SERVER_PORT).toBe(60173);
    });

    it("should have non-overlapping ports", () => {
      const ports = [
        DEFAULT_MCP_PROXY_PORT,
        DEFAULT_FILE_SERVER_PORT,
        DEFAULT_AGENT_RUNNER_PORT,
        DEFAULT_LANPROXY_PORT,
        DEFAULT_DEV_SERVER_PORT,
      ];
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(ports.length);
    });
  });

  describe("Host Configuration", () => {
    it("should have localhost configuration", () => {
      expect(LOCALHOST_IP).toBe("127.0.0.1");
      expect(LOCALHOST_HOSTNAME).toBe("localhost");
      expect(LOCAL_HOST_URL).toBe("http://127.0.0.1");
    });
  });

  describe("API URLs", () => {
    it("should have valid API URLs", () => {
      expect(DEFAULT_ANTHROPIC_API_URL).toMatch(/^https?:\/\//);
      expect(DEFAULT_SERVER_HOST).toMatch(/^https?:\/\//);
    });
  });

  describe("AI Configuration", () => {
    it("should have valid AI engine type", () => {
      expect(["claude-code", "nuwaxcode"]).toContain(DEFAULT_AI_ENGINE);
    });

    it("should have non-empty model name", () => {
      expect(DEFAULT_AI_MODEL).toBeTruthy();
      expect(DEFAULT_AI_MODEL.length).toBeGreaterThan(0);
    });

    it("should have valid token limits", () => {
      expect(DEFAULT_MAX_TOKENS).toBeGreaterThan(0);
    });

    it("should have valid temperature range", () => {
      expect(DEFAULT_TEMPERATURE).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_TEMPERATURE).toBeLessThanOrEqual(1);
    });

    it("should have model options with labels and values", () => {
      MODEL_OPTIONS.forEach((option) => {
        expect(option.label).toBeTruthy();
        expect(option.value).toBeTruthy();
      });
    });
  });

  describe("Timeout Configuration", () => {
    it("should have positive timeout values", () => {
      expect(DEFAULT_API_TIMEOUT).toBeGreaterThan(0);
      expect(DEFAULT_SSE_RETRY_DELAY).toBeGreaterThan(0);
      expect(DEFAULT_SSE_MAX_RETRY_DELAY).toBeGreaterThan(0);
      expect(DEFAULT_SSE_HEARTBEAT_INTERVAL).toBeGreaterThan(0);
      expect(DEFAULT_STARTUP_DELAY).toBeGreaterThan(0);
      expect(CLEANUP_TIMEOUT).toBeGreaterThan(0);
      expect(PROCESS_KILL_ESCALATION_TIMEOUT).toBeGreaterThan(0);
      expect(ACP_ABORT_TIMEOUT).toBeGreaterThan(0);
      expect(ENGINE_DESTROY_TIMEOUT).toBeGreaterThan(0);
      expect(DEPS_SYNC_TIMEOUT).toBeGreaterThan(0);
    });

    it("should have max retry delay greater than initial retry delay", () => {
      expect(DEFAULT_SSE_MAX_RETRY_DELAY).toBeGreaterThanOrEqual(
        DEFAULT_SSE_RETRY_DELAY,
      );
    });

    it("should have process kill escalation shorter than cleanup timeout", () => {
      expect(PROCESS_KILL_ESCALATION_TIMEOUT).toBeLessThan(CLEANUP_TIMEOUT);
    });

    it("should have ACP abort timeout shorter than engine destroy timeout", () => {
      expect(ACP_ABORT_TIMEOUT).toBeLessThanOrEqual(ENGINE_DESTROY_TIMEOUT);
    });

    it("should have deps sync timeout as the largest timeout", () => {
      expect(DEPS_SYNC_TIMEOUT).toBeGreaterThan(ENGINE_DESTROY_TIMEOUT);
      expect(DEPS_SYNC_TIMEOUT).toBeGreaterThan(CLEANUP_TIMEOUT);
    });
  });

  describe("Mirror Configuration", () => {
    it("should have npm mirror presets", () => {
      expect(NPM_MIRRORS.OFFICIAL).toContain("npmjs.org");
      expect(NPM_MIRRORS.TAOBAO).toContain("npmmirror");
      expect(NPM_MIRRORS.TENCENT).toContain("tencent");
    });

    it("should have uv mirror presets", () => {
      expect(UV_MIRRORS.OFFICIAL).toContain("pypi.org");
      expect(UV_MIRRORS.TUNA).toContain("tsinghua");
      expect(UV_MIRRORS.ALIYUN).toContain("aliyun");
      expect(UV_MIRRORS.TENCENT).toContain("tencent");
    });

    it("should have default mirror config", () => {
      expect(DEFAULT_MIRROR_CONFIG.npmRegistry).toBeTruthy();
      expect(DEFAULT_MIRROR_CONFIG.uvIndexUrl).toBeTruthy();
    });
  });

  describe("Storage Keys", () => {
    it("should have all required storage keys", () => {
      expect(STORAGE_KEYS.SETUP_STATE).toBe("setup_state");
      expect(STORAGE_KEYS.STEP1_CONFIG).toBe("step1_config");
      expect(STORAGE_KEYS.AUTH_USER).toBe("auth_user");
      expect(STORAGE_KEYS.API_KEY).toBe("anthropic_api_key");
    });

    it("should have auth keys", () => {
      expect(AUTH_KEYS.USERNAME).toBe("auth.username");
      expect(AUTH_KEYS.PASSWORD).toBe("auth.password");
      expect(AUTH_KEYS.SAVED_KEY).toBe("auth.saved_key");
    });
  });

  describe("Message Constants", () => {
    it("should have success messages", () => {
      expect(Object.keys(MSG_SUCCESS)).toContain("CONFIG_SAVED");
      expect(Object.keys(MSG_SUCCESS)).toContain("AGENT_STARTED");
      expect(Object.keys(MSG_SUCCESS)).toContain("LOGIN_SUCCESS");
    });

    it("should have error messages", () => {
      expect(Object.keys(MSG_ERROR)).toContain("CONFIG_SAVE_FAILED");
      expect(Object.keys(MSG_ERROR)).toContain("START_FAILED");
      expect(Object.keys(MSG_ERROR)).toContain("LOGIN_FAILED");
    });

    it("should have warning messages", () => {
      expect(Object.keys(MSG_WARNING)).toContain("INCOMPLETE_LOGIN_INFO");
      expect(Object.keys(MSG_WARNING)).toContain("MISSING_DEPENDENCIES");
    });

    it("should have info messages", () => {
      expect(Object.keys(MSG_INFO)).toContain("ALL_SERVICES_RUNNING");
      expect(Object.keys(MSG_INFO)).toContain("NO_RUNNING_SERVICES");
    });
  });

  describe("Dependency Status Labels", () => {
    it("should have all status labels", () => {
      expect(DEPENDENCY_STATUS_LABELS).toHaveProperty("checking");
      expect(DEPENDENCY_STATUS_LABELS).toHaveProperty("installed");
      expect(DEPENDENCY_STATUS_LABELS).toHaveProperty("missing");
      expect(DEPENDENCY_STATUS_LABELS).toHaveProperty("outdated");
      expect(DEPENDENCY_STATUS_LABELS).toHaveProperty("installing");
      expect(DEPENDENCY_STATUS_LABELS).toHaveProperty("bundled");
      expect(DEPENDENCY_STATUS_LABELS).toHaveProperty("error");
    });
  });

  describe("Service Names", () => {
    it("should have all service display names", () => {
      expect(SERVICE_NAMES).toHaveProperty("NuwaxFileServer");
      expect(SERVICE_NAMES).toHaveProperty("NuwaxLanproxy");
      expect(SERVICE_NAMES).toHaveProperty("Rcoder");
      expect(SERVICE_NAMES).toHaveProperty("McpProxy");
    });

    it("should have matching descriptions", () => {
      Object.keys(SERVICE_NAMES).forEach((key) => {
        expect(SERVICE_DESCRIPTIONS).toHaveProperty(key);
      });
    });
  });

  describe("Agent Status Config", () => {
    it("should have all agent statuses", () => {
      expect(AGENT_STATUS_CONFIG).toHaveProperty("idle");
      expect(AGENT_STATUS_CONFIG).toHaveProperty("starting");
      expect(AGENT_STATUS_CONFIG).toHaveProperty("running");
      expect(AGENT_STATUS_CONFIG).toHaveProperty("busy");
      expect(AGENT_STATUS_CONFIG).toHaveProperty("stopped");
      expect(AGENT_STATUS_CONFIG).toHaveProperty("error");
    });

    it("should have valid status types", () => {
      Object.values(AGENT_STATUS_CONFIG).forEach((config) => {
        expect(["default", "warning", "success"]).toContain(config.status);
      });
    });
  });

  describe("Service State Names", () => {
    it("should have all service state names", () => {
      expect(SERVICE_STATE_NAMES).toHaveProperty("Running");
      expect(SERVICE_STATE_NAMES).toHaveProperty("Stopped");
      expect(SERVICE_STATE_NAMES).toHaveProperty("Starting");
      expect(SERVICE_STATE_NAMES).toHaveProperty("Stopping");
      expect(SERVICE_STATE_NAMES).toHaveProperty("Error");
    });
  });
});
