/**
 * GUI Agent 跨平台键鼠输入服务
 *
 * 使用 @nut-tree/nut-js 实现跨平台键鼠控制。
 * 如果 nut-js 不可用，回退到 noop 模式（仅日志，不执行）。
 */

import log from "electron-log";
import type { InputAction, InputResponse } from "@shared/types/guiAgentTypes";

const TAG = "[GuiInput]";

// ==================== nut-js lazy loading ====================

let nutMouse: any = null;
let nutKeyboard: any = null;
let nutKey: any = null;
let nutButton: any = null;
let nutAvailable = false;
let nutLoadAttempted = false;

async function ensureNut(): Promise<boolean> {
  if (nutLoadAttempted) return nutAvailable;
  nutLoadAttempted = true;

  try {
    const nut = (await new Function("s", "return import(s)")(
      "@nut-tree/nut-js",
    )) as any;
    nutMouse = nut.mouse;
    nutKeyboard = nut.keyboard;
    nutKey = nut.Key;
    nutButton = nut.Button;

    // Configure nut-js
    if (nutMouse) {
      nutMouse.config.autoDelayMs = 0;
      nutMouse.config.mouseSpeed = 2000;
    }

    nutAvailable = true;
    log.info(`${TAG} @nut-tree/nut-js loaded successfully`);
  } catch (e) {
    nutAvailable = false;
    log.warn(`${TAG} @nut-tree/nut-js not available:`, e);
  }

  return nutAvailable;
}

// ==================== Key Mapping ====================

const KEY_MAP: Record<string, string> = {
  // Modifiers
  ctrl: "LeftControl",
  control: "LeftControl",
  shift: "LeftShift",
  alt: "LeftAlt",
  option: "LeftAlt",
  meta: "LeftSuper",
  cmd: "LeftSuper",
  command: "LeftSuper",
  win: "LeftSuper",
  super: "LeftSuper",

  // Navigation
  enter: "Return",
  return: "Return",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  space: "Space",

  // Arrow keys
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",

  // Function keys
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  f10: "F10",
  f11: "F11",
  f12: "F12",

  // Other
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  insert: "Insert",
  capslock: "CapsLock",
};

function resolveKey(keyName: string): any {
  if (!nutKey) return null;
  const mapped = KEY_MAP[keyName.toLowerCase()] || keyName;
  return nutKey[mapped] ?? null;
}

function resolveButton(button: string | undefined): any {
  if (!nutButton) return null;
  switch (button) {
    case "right":
      return nutButton.RIGHT;
    case "middle":
      return nutButton.MIDDLE;
    default:
      return nutButton.LEFT;
  }
}

// ==================== Actions ====================

async function delay(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * 执行输入操作
 */
export async function executeInput(
  action: InputAction,
  delayMs = 50,
): Promise<InputResponse> {
  const t0 = Date.now();

  const available = await ensureNut();
  if (!available) {
    throw new Error(
      "@nut-tree/nut-js is not available. Please install it: npm install @nut-tree/nut-js",
    );
  }

  await delay(delayMs);

  try {
    switch (action.type) {
      case "mouse_move": {
        await nutMouse.setPosition({ x: action.x, y: action.y });
        break;
      }

      case "mouse_click": {
        await nutMouse.setPosition({ x: action.x, y: action.y });
        const btn = resolveButton(action.button);
        await nutMouse.click(btn);
        break;
      }

      case "mouse_double_click": {
        await nutMouse.setPosition({ x: action.x, y: action.y });
        const btn = resolveButton(action.button);
        await nutMouse.doubleClick(btn);
        break;
      }

      case "mouse_drag": {
        await nutMouse.setPosition({ x: action.startX, y: action.startY });
        await nutMouse.pressButton(resolveButton(action.button));
        await nutMouse.setPosition({ x: action.endX, y: action.endY });
        await nutMouse.releaseButton(resolveButton(action.button));
        break;
      }

      case "mouse_scroll": {
        await nutMouse.setPosition({ x: action.x, y: action.y });
        if (action.deltaY !== 0) {
          if (action.deltaY > 0) {
            await nutMouse.scrollDown(action.deltaY);
          } else {
            await nutMouse.scrollUp(Math.abs(action.deltaY));
          }
        }
        break;
      }

      case "keyboard_type": {
        await nutKeyboard.type(action.text);
        break;
      }

      case "keyboard_press": {
        const key = resolveKey(action.key);
        if (!key) throw new Error(`Unknown key: ${action.key}`);
        await nutKeyboard.pressKey(key);
        await nutKeyboard.releaseKey(key);
        break;
      }

      case "keyboard_hotkey": {
        const keys = action.keys.map((k) => {
          const resolved = resolveKey(k);
          if (!resolved) throw new Error(`Unknown key in hotkey: ${k}`);
          return resolved;
        });
        for (const k of keys) await nutKeyboard.pressKey(k);
        for (const k of [...keys].reverse()) await nutKeyboard.releaseKey(k);
        break;
      }

      default:
        throw new Error(`Unknown action type: ${(action as any).type}`);
    }

    return {
      success: true,
      action: action.type,
      elapsed: Date.now() - t0,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`${TAG} Input action failed: ${action.type}`, msg);
    throw error;
  }
}

/**
 * 获取当前鼠标位置
 */
export async function getCursorPosition(): Promise<{ x: number; y: number }> {
  const available = await ensureNut();
  if (!available) {
    throw new Error("@nut-tree/nut-js is not available");
  }
  const pos = await nutMouse.getPosition();
  return { x: pos.x, y: pos.y };
}

/**
 * 检查 nut-js 是否可用
 */
export async function isInputAvailable(): Promise<boolean> {
  return ensureNut();
}
