import { describe, expect, it } from "vitest";
import {
  SANDBOX_OPERATIONS,
  generateSandboxMatrixDocument,
  renderSandboxMatrixMarkdown,
  stringifySandboxMatrixJson,
} from "./sandboxMatrix";

describe("sandboxMatrix", () => {
  it("should generate complete rules for every sandbox combination", () => {
    const doc = generateSandboxMatrixDocument();

    const sandboxRules = doc.rules.filter((r) => r.layer === "sandbox");
    const expectedCombinations = 3 + 3 + 6 + 3; // darwin + linux + windows + docker
    const expectedRuleCount = expectedCombinations * SANDBOX_OPERATIONS.length;

    expect(sandboxRules).toHaveLength(expectedRuleCount);
  });

  it("should mark docker backend as unsupported", () => {
    const doc = generateSandboxMatrixDocument();
    const dockerRules = doc.rules.filter((r) => r.backend === "docker");

    expect(dockerRules.length).toBeGreaterThan(0);
    for (const row of dockerRules) {
      expect(row.verdict).toBe("unsupported");
    }
  });

  it("should include both command allowlist and denylist", () => {
    const doc = generateSandboxMatrixDocument();
    expect(doc.permissionLists.commandAllowlist.length).toBeGreaterThan(0);
    expect(doc.permissionLists.commandDenylist.length).toBeGreaterThan(0);
  });

  it("should produce deterministic json and markdown outputs", () => {
    const doc = generateSandboxMatrixDocument();

    const json = stringifySandboxMatrixJson(doc);
    const md = renderSandboxMatrixMarkdown(doc);

    expect(json.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n")).toBe(true);
    expect(md).toContain("Sandbox Whitelist / Blacklist Matrix (Generated)");
    expect(md).toContain(
      "| layer | platform | backend | mode | windowsMode | operationId | verdict | reason |",
    );
  });
});
