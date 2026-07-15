import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/createProgram.js";

function commandNames() {
  return createProgram().commands.map((command) => command.name());
}

function optionLongNames(commandName: string): string[] {
  const command = createProgram().commands.find(
    (cmd) => cmd.name() === commandName,
  );
  if (!command) throw new Error(`missing command ${commandName}`);
  return command.options
    .map((option) => option.long)
    .filter(Boolean) as string[];
}

describe("createProgram", () => {
  it("registers the public top-level command surface", () => {
    expect(commandNames()).toEqual([
      "doctor",
      "chat",
      "sessions",
      "context",
      "login",
      "logout",
      "status",
      "config",
      "account",
      "serve",
      "up",
      "service",
      "update",
    ]);
  });

  it("registers shared serve/up options exactly once", () => {
    for (const commandName of ["serve", "up"]) {
      const options = optionLongNames(commandName);
      expect(options.filter((name) => name === "--port")).toHaveLength(1);
      expect(options.filter((name) => name === "--host")).toHaveLength(1);
      expect(options.filter((name) => name === "--daemon")).toHaveLength(1);
      expect(options.filter((name) => name === "--api-key")).toHaveLength(1);
    }
  });
});
