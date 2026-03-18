/**
 * 单元测试: ManagedProcess — stop() 监听器清理 & kill() 升级超时
 *
 * 覆盖内容：
 * - stop() 调用 removeAllListeners 防止句柄泄漏
 * - stop() 在无进程时返回 Not running
 * - kill() SIGTERM→SIGKILL 升级使用 PROCESS_KILL_ESCALATION_TIMEOUT
 * - kill() 在无进程时不报错
 * - kill() 升级定时器在进程正常退出后被清除
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { ManagedProcess } from "./processManager";
import { PROCESS_KILL_ESCALATION_TIMEOUT } from "@shared/constants";

/** Create a fake ChildProcess-like object */
function createFakeProc() {
  const proc = new EventEmitter() as any;
  proc.pid = 12345;
  proc.killed = false;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

/** Inject a fake process into a ManagedProcess instance */
function injectProcess(mp: ManagedProcess, proc: any) {
  (mp as any).process = proc;
}

describe("ManagedProcess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("stop()", () => {
    it("returns Not running when no process exists", () => {
      const mp = new ManagedProcess("test");
      const result = mp.stop();
      expect(result).toEqual({ success: true, message: "Not running" });
    });

    it("removes all listeners before killing", () => {
      const mp = new ManagedProcess("test");
      const proc = createFakeProc();
      injectProcess(mp, proc);

      const stdoutRemove = vi.spyOn(proc.stdout, "removeAllListeners");
      const stderrRemove = vi.spyOn(proc.stderr, "removeAllListeners");
      const stdinRemove = vi.spyOn(proc.stdin, "removeAllListeners");
      const procRemove = vi.spyOn(proc, "removeAllListeners");

      const result = mp.stop();

      expect(result).toEqual({ success: true });
      expect(stdoutRemove).toHaveBeenCalled();
      expect(stderrRemove).toHaveBeenCalled();
      expect(stdinRemove).toHaveBeenCalled();
      expect(procRemove).toHaveBeenCalled();
      expect(proc.kill).toHaveBeenCalled();
      expect(mp.running).toBe(false);
    });

    it("sets process to null before calling kill", () => {
      const mp = new ManagedProcess("test");
      const proc = createFakeProc();
      injectProcess(mp, proc);

      let runningDuringKill: boolean | undefined;
      proc.kill = vi.fn(() => {
        runningDuringKill = mp.running;
      });

      mp.stop();
      expect(runningDuringKill).toBe(false);
    });
  });

  describe("kill()", () => {
    it("does not throw when no process exists", () => {
      const mp = new ManagedProcess("test");
      expect(() => mp.kill()).not.toThrow();
    });

    it("sends SIGTERM and schedules SIGKILL escalation", () => {
      vi.useFakeTimers();
      const mp = new ManagedProcess("test");
      const proc = createFakeProc();
      injectProcess(mp, proc);

      const processKillSpy = vi
        .spyOn(process, "kill")
        .mockImplementation(() => true);

      mp.kill();

      expect(proc.kill).toHaveBeenCalled();
      expect(mp.running).toBe(false);

      // Escalation should not have fired yet
      expect(processKillSpy).not.toHaveBeenCalled();

      // Advance past PROCESS_KILL_ESCALATION_TIMEOUT
      vi.advanceTimersByTime(PROCESS_KILL_ESCALATION_TIMEOUT + 1);

      expect(processKillSpy).toHaveBeenCalledWith(proc.pid, "SIGKILL");
      processKillSpy.mockRestore();
    });

    it("clears escalation timer if process exits promptly", () => {
      vi.useFakeTimers();
      const mp = new ManagedProcess("test");
      const proc = createFakeProc();
      injectProcess(mp, proc);

      const processKillSpy = vi
        .spyOn(process, "kill")
        .mockImplementation(() => true);

      mp.kill();

      // Simulate prompt exit
      proc.emit("exit", 0, null);

      // Advance past escalation timeout — SIGKILL should NOT fire
      vi.advanceTimersByTime(PROCESS_KILL_ESCALATION_TIMEOUT + 1);

      expect(processKillSpy).not.toHaveBeenCalled();
      processKillSpy.mockRestore();
    });

    it("removes all listeners on the process", () => {
      const mp = new ManagedProcess("test");
      const proc = createFakeProc();
      injectProcess(mp, proc);

      const removeAll = vi.spyOn(proc, "removeAllListeners");
      const stdoutRemove = vi.spyOn(proc.stdout, "removeAllListeners");

      mp.kill();

      expect(removeAll).toHaveBeenCalled();
      expect(stdoutRemove).toHaveBeenCalled();
    });
  });
});
