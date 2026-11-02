/**
 * Unit tests for desktop/mouse.ts — click, doubleClick, moveTo, drag, scroll, getPosition.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMove = vi.fn();
const mockClick = vi.fn();
const mockDoubleClick = vi.fn();
const mockPressButton = vi.fn();
const mockReleaseButton = vi.fn();
const mockScrollDown = vi.fn();
const mockScrollUp = vi.fn();
const mockScrollLeft = vi.fn();
const mockScrollRight = vi.fn();
const mockGetPosition = vi.fn();
const mockStraightTo = vi.fn();

vi.mock('@nut-tree-fork/nut-js', () => {
  class MockPoint {
    constructor(public x: number, public y: number) {}
  }
  return {
    mouse: {
      move: (...args: any[]) => mockMove(...args),
      click: (...args: any[]) => mockClick(...args),
      doubleClick: (...args: any[]) => mockDoubleClick(...args),
      pressButton: (...args: any[]) => mockPressButton(...args),
      releaseButton: (...args: any[]) => mockReleaseButton(...args),
      scrollDown: (...args: any[]) => mockScrollDown(...args),
      scrollUp: (...args: any[]) => mockScrollUp(...args),
      scrollLeft: (...args: any[]) => mockScrollLeft(...args),
      scrollRight: (...args: any[]) => mockScrollRight(...args),
      getPosition: () => mockGetPosition(),
    },
    Button: { LEFT: 'LEFT', RIGHT: 'RIGHT', MIDDLE: 'MIDDLE' },
    Point: MockPoint,
    straightTo: (p: any) => mockStraightTo(p),
  };
});

import { click, doubleClick, moveTo, drag, scroll, getPosition } from '../../src/desktop/mouse.js';

describe('click', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMove.mockResolvedValue(undefined);
    mockClick.mockResolvedValue(undefined);
    mockStraightTo.mockImplementation((p: any) => p);
  });

  it('moves to position and clicks left button by default', async () => {
    await click(100, 200);
    expect(mockStraightTo).toHaveBeenCalledWith(expect.objectContaining({ x: 100, y: 200 }));
    expect(mockMove).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalledWith('LEFT');
  });

  it('supports right button', async () => {
    await click(50, 60, 'right');
    expect(mockClick).toHaveBeenCalledWith('RIGHT');
  });

  it('supports middle button', async () => {
    await click(50, 60, 'middle');
    expect(mockClick).toHaveBeenCalledWith('MIDDLE');
  });

  it('wraps errors as DesktopError', async () => {
    mockMove.mockRejectedValue(new Error('screen locked'));
    await expect(click(0, 0)).rejects.toThrow('mouse.click');
  });
});

describe('doubleClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMove.mockResolvedValue(undefined);
    mockDoubleClick.mockResolvedValue(undefined);
    mockStraightTo.mockImplementation((p: any) => p);
  });

  it('moves and double-clicks', async () => {
    await doubleClick(300, 400);
    expect(mockMove).toHaveBeenCalled();
    expect(mockDoubleClick).toHaveBeenCalledWith('LEFT');
  });

  it('wraps errors as DesktopError', async () => {
    mockDoubleClick.mockRejectedValue(new Error('fail'));
    await expect(doubleClick(0, 0)).rejects.toThrow('mouse.doubleClick');
  });
});

describe('moveTo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMove.mockResolvedValue(undefined);
    mockStraightTo.mockImplementation((p: any) => p);
  });

  it('moves mouse to coordinates', async () => {
    await moveTo(500, 600);
    expect(mockStraightTo).toHaveBeenCalledWith(expect.objectContaining({ x: 500, y: 600 }));
    expect(mockMove).toHaveBeenCalled();
  });

  it('wraps errors as DesktopError', async () => {
    mockMove.mockRejectedValue(new Error('fail'));
    await expect(moveTo(0, 0)).rejects.toThrow('mouse.moveTo');
  });
});

describe('drag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMove.mockResolvedValue(undefined);
    mockPressButton.mockResolvedValue(undefined);
    mockReleaseButton.mockResolvedValue(undefined);
    mockStraightTo.mockImplementation((p: any) => p);
  });

  it('moves to start, presses, moves to end, releases', async () => {
    await drag(10, 20, 100, 200);

    expect(mockMove).toHaveBeenCalledTimes(2);
    expect(mockPressButton).toHaveBeenCalledWith('LEFT');
    expect(mockReleaseButton).toHaveBeenCalledWith('LEFT');

    // First move to start
    const firstMove = mockStraightTo.mock.calls[0][0];
    expect(firstMove.x).toBe(10);
    expect(firstMove.y).toBe(20);

    // Second move to end
    const secondMove = mockStraightTo.mock.calls[1][0];
    expect(secondMove.x).toBe(100);
    expect(secondMove.y).toBe(200);
  });

  it('supports right button drag', async () => {
    await drag(0, 0, 50, 50, 'right');
    expect(mockPressButton).toHaveBeenCalledWith('RIGHT');
    expect(mockReleaseButton).toHaveBeenCalledWith('RIGHT');
  });

  it('wraps errors as DesktopError', async () => {
    mockPressButton.mockRejectedValue(new Error('fail'));
    await expect(drag(0, 0, 10, 10)).rejects.toThrow('mouse.drag');
  });
});

describe('scroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMove.mockResolvedValue(undefined);
    mockScrollDown.mockResolvedValue(undefined);
    mockScrollUp.mockResolvedValue(undefined);
    mockScrollLeft.mockResolvedValue(undefined);
    mockScrollRight.mockResolvedValue(undefined);
    mockStraightTo.mockImplementation((p: any) => p);
  });

  it('scrolls down with positive deltaY', async () => {
    await scroll(100, 200, 5);
    expect(mockMove).toHaveBeenCalled();
    expect(mockScrollDown).toHaveBeenCalledWith(5);
    expect(mockScrollUp).not.toHaveBeenCalled();
  });

  it('scrolls up with negative deltaY', async () => {
    await scroll(100, 200, -3);
    expect(mockScrollUp).toHaveBeenCalledWith(3);
    expect(mockScrollDown).not.toHaveBeenCalled();
  });

  it('does not scroll vertically when deltaY is 0', async () => {
    await scroll(100, 200, 0);
    expect(mockScrollDown).not.toHaveBeenCalled();
    expect(mockScrollUp).not.toHaveBeenCalled();
  });

  it('scrolls right with positive deltaX', async () => {
    await scroll(100, 200, 0, 4);
    expect(mockScrollRight).toHaveBeenCalledWith(4);
  });

  it('scrolls left with negative deltaX', async () => {
    await scroll(100, 200, 0, -2);
    expect(mockScrollLeft).toHaveBeenCalledWith(2);
  });

  it('wraps errors as DesktopError', async () => {
    mockMove.mockRejectedValue(new Error('fail'));
    await expect(scroll(0, 0, 1)).rejects.toThrow('mouse.scroll');
  });
});

describe('getPosition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns cursor position', async () => {
    mockGetPosition.mockResolvedValue({ x: 350, y: 450 });
    const pos = await getPosition();
    expect(pos).toEqual({ x: 350, y: 450 });
  });

  it('wraps errors as DesktopError', async () => {
    mockGetPosition.mockRejectedValue(new Error('fail'));
    await expect(getPosition()).rejects.toThrow('mouse.getPosition');
  });
});
