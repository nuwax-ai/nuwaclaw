/**
 * Mouse operations wrapper around nut.js.
 */

import { DesktopError } from '../utils/errors.js';

type ButtonType = 'left' | 'right' | 'middle';

async function getNutMouse() {
  const { mouse, Button, Point, straightTo } = await import('@nut-tree-fork/nut-js');
  return { mouse, Button, Point, straightTo };
}

function mapButton(button: ButtonType | undefined, Button: any): any {
  switch (button) {
    case 'right': return Button.RIGHT;
    case 'middle': return Button.MIDDLE;
    default: return Button.LEFT;
  }
}

export async function click(x: number, y: number, button?: ButtonType): Promise<void> {
  try {
    const { mouse, Button, Point, straightTo } = await getNutMouse();
    await mouse.move(straightTo(new Point(x, y)));
    await mouse.click(mapButton(button, Button));
  } catch (err) {
    throw new DesktopError('mouse.click', err instanceof Error ? err : new Error(String(err)));
  }
}

export async function doubleClick(x: number, y: number, button?: ButtonType): Promise<void> {
  try {
    const { mouse, Button, Point, straightTo } = await getNutMouse();
    await mouse.move(straightTo(new Point(x, y)));
    await mouse.doubleClick(mapButton(button, Button));
  } catch (err) {
    throw new DesktopError('mouse.doubleClick', err instanceof Error ? err : new Error(String(err)));
  }
}

export async function moveTo(x: number, y: number): Promise<void> {
  try {
    const { mouse, Point, straightTo } = await getNutMouse();
    await mouse.move(straightTo(new Point(x, y)));
  } catch (err) {
    throw new DesktopError('mouse.moveTo', err instanceof Error ? err : new Error(String(err)));
  }
}

export async function drag(startX: number, startY: number, endX: number, endY: number, button?: ButtonType): Promise<void> {
  try {
    const { mouse, Button, Point, straightTo } = await getNutMouse();
    await mouse.move(straightTo(new Point(startX, startY)));
    await mouse.pressButton(mapButton(button, Button));
    await mouse.move(straightTo(new Point(endX, endY)));
    await mouse.releaseButton(mapButton(button, Button));
  } catch (err) {
    throw new DesktopError('mouse.drag', err instanceof Error ? err : new Error(String(err)));
  }
}

export async function scroll(x: number, y: number, deltaY: number, deltaX?: number): Promise<void> {
  try {
    const { mouse, Point, straightTo } = await getNutMouse();
    await mouse.move(straightTo(new Point(x, y)));
    if (deltaY > 0) {
      await mouse.scrollDown(Math.abs(deltaY));
    } else if (deltaY < 0) {
      await mouse.scrollUp(Math.abs(deltaY));
    }
    if (deltaX && deltaX > 0) {
      await mouse.scrollRight(Math.abs(deltaX));
    } else if (deltaX && deltaX < 0) {
      await mouse.scrollLeft(Math.abs(deltaX));
    }
  } catch (err) {
    throw new DesktopError('mouse.scroll', err instanceof Error ? err : new Error(String(err)));
  }
}

export async function getPosition(): Promise<{ x: number; y: number }> {
  try {
    const { mouse } = await getNutMouse();
    const pos = await mouse.getPosition();
    return { x: pos.x, y: pos.y };
  } catch (err) {
    throw new DesktopError('mouse.getPosition', err instanceof Error ? err : new Error(String(err)));
  }
}
