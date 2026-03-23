/**
 * Keyboard operations with CJK/long text routing.
 *
 * - Non-ASCII or text > 50 chars → clipboard paste
 * - Otherwise → nut.js keyboard.type()
 */

import { DesktopError } from '../utils/errors.js';
import { pasteText } from './clipboard.js';

const NON_ASCII_RE = /[^\x00-\x7F]/;
const MAX_TYPE_LENGTH = 50;

/**
 * Key name aliases mapping to nut.js Key enum names.
 * LLMs may return various names like "Meta", "Command", "Cmd", "Win", "Super".
 * nut.js uses: LeftSuper, RightSuper, LeftControl, RightControl, etc.
 * Arrow keys in nut.js are: Up, Down, Left, Right (not ArrowUp, etc.)
 */
const KEY_ALIASES: Record<string, string> = {
  // macOS Command key aliases → Super
  Meta: 'LeftSuper',
  Command: 'LeftSuper',
  Cmd: 'LeftSuper',
  '⌘': 'LeftSuper',
  // Windows/Linux Super/Win key aliases
  Win: 'LeftSuper',
  Super: 'LeftSuper',
  // Control key aliases
  Control: 'LeftControl',
  Ctrl: 'LeftControl',
  '⌃': 'LeftControl',
  // Alt/Option key aliases
  Alt: 'LeftAlt',
  Option: 'LeftAlt',
  Opt: 'LeftAlt',
  '⌥': 'LeftAlt',
  // Shift key aliases
  Shift: 'LeftShift',
  '⇧': 'LeftShift',
  // Arrow key aliases (nut.js uses Up/Down/Left/Right, not ArrowUp/ArrowDown)
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  // Common alternative names
  Return: 'Enter',
  Esc: 'Escape',
  Del: 'Delete',
  Ins: 'Insert',
};

/**
 * Type text with smart routing:
 * - CJK/non-ASCII or long text → clipboard paste
 * - Short ASCII → direct nut.js typing
 */
export async function typeText(text: string): Promise<void> {
  if (NON_ASCII_RE.test(text) || text.length > MAX_TYPE_LENGTH) {
    await pasteText(text);
    return;
  }

  try {
    const { keyboard } = await import('@nut-tree-fork/nut-js');
    await keyboard.type(text);
  } catch (err) {
    throw new DesktopError('keyboard.typeText', err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Normalize key name using aliases mapping.
 */
function normalizeKeyName(key: string): string {
  // First check aliases
  if (KEY_ALIASES[key]) {
    return KEY_ALIASES[key];
  }
  // Then return as-is (for F1-F24, ArrowUp, Escape, etc.)
  return key;
}

/**
 * Press a single key by name.
 */
export async function pressKey(key: string): Promise<void> {
  try {
    const { keyboard, Key } = await import('@nut-tree-fork/nut-js');
    const normalizedKey = normalizeKeyName(key);
    const keyObj = Key[normalizedKey as keyof typeof Key];
    if (keyObj === undefined) {
      throw new Error(`Unknown key: ${key} (normalized: ${normalizedKey})`);
    }
    await keyboard.pressKey(keyObj);
    await keyboard.releaseKey(keyObj);
  } catch (err) {
    throw new DesktopError('keyboard.pressKey', err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Press a key combination (hotkey).
 *
 * Note: nut.js pressKey doesn't support multiple keys, but type() does.
 * For hotkeys, we use keyboard.type(Key1, Key2, ...) which simulates
 * pressing keys together as a combination.
 */
export async function hotkey(keys: string[]): Promise<void> {
  try {
    const { keyboard, Key } = await import('@nut-tree-fork/nut-js');
    const keyObjs = keys.map(k => {
      const normalizedKey = normalizeKeyName(k);
      const keyObj = Key[normalizedKey as keyof typeof Key];
      if (keyObj === undefined) {
        throw new Error(`Unknown key: ${k} (normalized: ${normalizedKey})`);
      }
      return keyObj;
    });
    // Use keyboard.type() for hotkeys - it handles key combinations correctly
    await keyboard.type(...keyObjs);
  } catch (err) {
    throw new DesktopError('keyboard.hotkey', err instanceof Error ? err : new Error(String(err)));
  }
}
