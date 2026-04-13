import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generateSandboxMatrixDocument,
  renderSandboxMatrixMarkdown,
  stringifySandboxMatrixJson,
} from "@main/services/sandbox/sandboxMatrix";

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testFileDir, "..", "..");
const repoRoot = path.resolve(projectRoot, "..", "..");

const docsDir = path.join(repoRoot, "docs");
const jsonPath = path.join(docsDir, "sandbox-matrix.generated.json");
const mdPath = path.join(docsDir, "sandbox-matrix.generated.md");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

describe("sandbox matrix artifact consistency", () => {
  it("should generate deterministic matrix artifacts and keep repository baseline in sync", () => {
    const doc = generateSandboxMatrixDocument();
    const generatedJson = stringifySandboxMatrixJson(doc);
    const generatedMd = renderSandboxMatrixMarkdown(doc);
    const writeMode = process.env.SANDBOX_MATRIX_WRITE === "1";

    if (writeMode) {
      ensureDir(docsDir);
      fs.writeFileSync(jsonPath, generatedJson, "utf8");
      fs.writeFileSync(mdPath, generatedMd, "utf8");
    }

    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const baselineJson = fs.readFileSync(jsonPath, "utf8");
    const baselineMd = fs.readFileSync(mdPath, "utf8");

    expect(baselineJson).toBe(generatedJson);
    expect(baselineMd).toBe(generatedMd);
  });
});

