import { describe, it, expect } from "vitest";

// 直接测试 schema 定义（从 processHandlers.ts 中提取）
import { z } from "zod";

// 复制 schema 定义用于测试（实际使用时从模块导入）
const lanproxyConfigSchema = z.object({
  serverIp: z.string().min(1),
  serverPort: z.number().int().positive(),
  clientKey: z.string().min(1),
  ssl: z.boolean().optional(),
});

const agentRunnerConfigSchema = z.object({
  binPath: z.string().min(1),
  backendPort: z.number().int().positive(),
  proxyPort: z.number().int().positive(),
  apiKey: z.string().min(1),
  apiBaseUrl: z.string().min(1),
  defaultModel: z.string().min(1),
});

const portSchema = z.number().int().positive();

describe("lanproxyConfigSchema", () => {
  it("should accept valid config", () => {
    const result = lanproxyConfigSchema.safeParse({
      serverIp: "192.168.1.1",
      serverPort: 8080,
      clientKey: "test-client-key",
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid config with ssl", () => {
    const result = lanproxyConfigSchema.safeParse({
      serverIp: "example.com",
      serverPort: 443,
      clientKey: "key-123",
      ssl: true,
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty serverIp", () => {
    const result = lanproxyConfigSchema.safeParse({
      serverIp: "",
      serverPort: 8080,
      clientKey: "test-key",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("serverIp");
    }
  });

  it("should reject zero serverPort", () => {
    const result = lanproxyConfigSchema.safeParse({
      serverIp: "192.168.1.1",
      serverPort: 0,
      clientKey: "test-key",
    });
    expect(result.success).toBe(false);
  });

  it("should reject negative serverPort", () => {
    const result = lanproxyConfigSchema.safeParse({
      serverIp: "192.168.1.1",
      serverPort: -1,
      clientKey: "test-key",
    });
    expect(result.success).toBe(false);
  });

  it("should reject non-integer serverPort", () => {
    const result = lanproxyConfigSchema.safeParse({
      serverIp: "192.168.1.1",
      serverPort: 8080.5,
      clientKey: "test-key",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty clientKey", () => {
    const result = lanproxyConfigSchema.safeParse({
      serverIp: "192.168.1.1",
      serverPort: 8080,
      clientKey: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing required fields", () => {
    const result = lanproxyConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("serverIp");
      expect(paths).toContain("serverPort");
      expect(paths).toContain("clientKey");
    }
  });
});

describe("agentRunnerConfigSchema", () => {
  const validConfig = {
    binPath: "/path/to/agent",
    backendPort: 3000,
    proxyPort: 3001,
    apiKey: "test-api-key",
    apiBaseUrl: "https://api.example.com",
    defaultModel: "claude-3",
  };

  it("should accept valid config", () => {
    const result = agentRunnerConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("should reject empty binPath", () => {
    const result = agentRunnerConfigSchema.safeParse({
      ...validConfig,
      binPath: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid apiBaseUrl", () => {
    const result = agentRunnerConfigSchema.safeParse({
      ...validConfig,
      apiBaseUrl: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject zero ports", () => {
    const result = agentRunnerConfigSchema.safeParse({
      ...validConfig,
      backendPort: 0,
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing all required fields", () => {
    const result = agentRunnerConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("portSchema", () => {
  it("should accept valid port", () => {
    expect(portSchema.safeParse(8080).success).toBe(true);
    expect(portSchema.safeParse(1).success).toBe(true);
    expect(portSchema.safeParse(65535).success).toBe(true);
  });

  it("should reject zero", () => {
    expect(portSchema.safeParse(0).success).toBe(false);
  });

  it("should reject negative", () => {
    expect(portSchema.safeParse(-1).success).toBe(false);
  });

  it("should reject non-integer", () => {
    expect(portSchema.safeParse(8080.5).success).toBe(false);
  });

  it("should reject string", () => {
    expect(portSchema.safeParse("8080").success).toBe(false);
  });
});
