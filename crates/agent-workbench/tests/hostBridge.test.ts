import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchHostBridge } from '../src/types';

describe('WorkbenchHostBridge preview hooks', () => {
  it('onBeforePreviewLoad is invoked before preview URL is shown', async () => {
    const onBeforePreviewLoad = vi.fn(async () => undefined);
    const bridge: WorkbenchHostBridge = { onBeforePreviewLoad };

    const url = 'https://app.example.com/page/1';
    await bridge.onBeforePreviewLoad?.(url);

    expect(onBeforePreviewLoad).toHaveBeenCalledWith(url);
  });

  it('getPreviewUserAgent returns optional user agent string', async () => {
    const bridge: WorkbenchHostBridge = {
      getPreviewUserAgent: async () => 'NuwaClaw/0.9.7',
    };

    await expect(bridge.getPreviewUserAgent?.()).resolves.toBe('NuwaClaw/0.9.7');
  });
});
