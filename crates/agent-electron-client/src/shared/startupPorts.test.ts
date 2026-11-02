import { describe, it, expect } from "vitest";
import {
  isValidSetupWizardPort,
  SETUP_WIZARD_PORT_MIN,
  SETUP_WIZARD_PORT_MAX,
} from "./startupPorts";

describe("isValidSetupWizardPort", () => {
  it("接受初始化向导范围内的整数端口", () => {
    expect(isValidSetupWizardPort(SETUP_WIZARD_PORT_MIN)).toBe(true);
    expect(isValidSetupWizardPort(60009)).toBe(true);
    expect(isValidSetupWizardPort(SETUP_WIZARD_PORT_MAX)).toBe(true);
  });

  it("拒绝越界、非整数或空值", () => {
    expect(isValidSetupWizardPort(SETUP_WIZARD_PORT_MIN - 1)).toBe(false);
    expect(isValidSetupWizardPort(SETUP_WIZARD_PORT_MAX + 1)).toBe(false);
    expect(isValidSetupWizardPort(60009.5)).toBe(false);
    expect(isValidSetupWizardPort(0)).toBe(false);
    expect(isValidSetupWizardPort(null)).toBe(false);
    expect(isValidSetupWizardPort(undefined)).toBe(false);
  });
});
