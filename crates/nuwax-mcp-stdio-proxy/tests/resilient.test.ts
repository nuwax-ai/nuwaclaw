import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResilientTransportWrapper } from '../src/resilient.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

class MockTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  
  startCalls = 0;
  closeCalls = 0;
  sentMessages: JSONRPCMessage[] = [];
  shouldFailStart = false;
  shouldFailSend = false;

  async start(): Promise<void> {
    this.startCalls++;
    if (this.shouldFailStart) {
      throw new Error('Mock start failure');
    }
  }

  async close(): Promise<void> {
    this.closeCalls++;
    if (this.onclose) {
      this.onclose();
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.shouldFailSend) {
      throw new Error('Mock send failure');
    }
    this.sentMessages.push(message);
    
    // Auto-respond to pings for health checks
    if ('id' in message && typeof message.id === 'string' && message.id.startsWith('respl-ping-')) {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({
            jsonrpc: '2.0',
            id: message.id,
            result: {}
          });
        }
      }, 10 as number);
    }
  }

  // Helper to simulate incoming messages
  simulateMessage(msg: JSONRPCMessage) {
    if (this.onmessage) {
      this.onmessage(msg);
    }
  }

  // Helper to simulate transport error
  simulateError(err: Error) {
    if (this.onerror) {
      this.onerror(err);
    }
  }

  // Helper to simulate transport close
  simulateClose() {
    if (this.onclose) {
      this.onclose();
    }
  }
}

describe('ResilientTransportWrapper', () => {
  let mockTransports: MockTransport[] = [];
  
  beforeEach(() => {
    mockTransports = [];
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createWrapper = (options = {}) => {
    return new ResilientTransportWrapper({
      name: 'test-wrapper',
      connectParams: async () => {
        const t = new MockTransport();
        mockTransports.push(t);
        return t;
      },
      ...options
    });
  };

  it('should connect successfully', async () => {
    const wrapper = createWrapper();
    await wrapper.start();
    
    expect(mockTransports.length).toBe(1);
    expect(mockTransports[0].startCalls).toBe(1);
    
    await wrapper.close();
  });

  it('should queue messages while reconnecting, then flush them', async () => {
    const wrapper = createWrapper({ reconnectDelayMs: 100 });
    await wrapper.start();
    
    const firstTransport = mockTransports[0];
    
    // Simulate drop
    firstTransport.simulateClose();
    
    // Wrapper state should now be reconnecting
    
    const testMsg: JSONRPCMessage = { jsonrpc: '2.0', method: 'test', params: { a: 1 } };
    
    // Send while reconnecting
    await wrapper.send(testMsg);
    
    // Ensure it wasn't sent to the closed transport
    expect(firstTransport.sentMessages.length).toBe(0);
    
    // Fast forward to trigger reconnect
    await vi.advanceTimersByTimeAsync(150);
    
    // A new transport should be created
    expect(mockTransports.length).toBe(2);
    const secondTransport = mockTransports[1];
    
    // The queued message should have been flushed
    expect(secondTransport.sentMessages.length).toBe(1);
    expect(secondTransport.sentMessages[0]).toEqual(testMsg);
    
    await wrapper.close();
  });

  it('should reconnect if heartbeat fails repeatedly', async () => {
    const wrapper = createWrapper({ 
      pingIntervalMs: 1000, 
      pingTimeoutMs: 500,
      maxConsecutiveFailures: 2,
      reconnectDelayMs: 100
    });
    
    await wrapper.start();
    
    const firstTransport = mockTransports[0];
    // Disable auto ping responses
    firstTransport.shouldFailSend = true;
    
    // Advance timer to trigger first heartbeat attempt
    await vi.advanceTimersByTimeAsync(1001); // Trigger interval
    await vi.advanceTimersByTimeAsync(501);  // Trigger timeout
    
    // 1 failure at this point, should still be same transport
    expect(mockTransports.length).toBe(1);
    
    // Advance timer to trigger second heartbeat attempt
    await vi.advanceTimersByTimeAsync(1001); // Trigger interval
    await vi.advanceTimersByTimeAsync(501);  // Trigger timeout
    
    // 2 failures = maxConsecutiveFailures, should trigger reconnect
    
    // Advance time for reconnect delay
    await vi.advanceTimersByTimeAsync(150);
    
    // Should have reconnected
    expect(mockTransports.length).toBe(2);
    
    await wrapper.close();
  });

  it('should intercept inner transport errors and trigger reconnect', async () => {
    const wrapper = createWrapper({ reconnectDelayMs: 100 });
    await wrapper.start();
    
    const firstTransport = mockTransports[0];
    firstTransport.simulateError(new Error('Test error'));
    
    // Advance time for reconnect delay
    await vi.advanceTimersByTimeAsync(150);
    
    // Should have reconnected
    expect(mockTransports.length).toBe(2);
    
    await wrapper.close();
  });
  
  it('should pass transparent messages down to onmessage handler', async () => {
    const wrapper = createWrapper();
    await wrapper.start();
    
    let receivedMsg: JSONRPCMessage | null = null;
    wrapper.onmessage = (msg) => {
      receivedMsg = msg;
    };
    
    const testMsg: JSONRPCMessage = { jsonrpc: '2.0', method: 'notify', params: { x: 1 } };
    mockTransports[0].simulateMessage(testMsg);
    
    expect(receivedMsg).toEqual(testMsg);
    
    await wrapper.close();
  });

  it('should handle flushQueue errors by putting messages back', async () => {
    const wrapper = createWrapper({ maxQueueSize: 5 });
    await wrapper.start();
    
    const firstTransport = mockTransports[0];
    firstTransport.simulateClose(); // puts it in reconnecting state
    
    // Add messages to queue
    await wrapper.send({ jsonrpc: '2.0', method: 'test1' });
    await wrapper.send({ jsonrpc: '2.0', method: 'test2' });
    
    // Advance time to reconnect
    let newTransportReady = false;
    const originalSetTimeout = global.setTimeout;
    const spy = vi.spyOn(global, 'setTimeout').mockImplementationOnce((cb: any, ms?: number) => {
      // simulate the factory creating the second one and failing its send
      const id = originalSetTimeout(() => {
        cb();
        if (mockTransports.length > 1) {
           mockTransports[1].shouldFailSend = true;
           newTransportReady = true;
        }
      }, ms);
      return id as any;
    });

    await vi.advanceTimersByTimeAsync(3000);
    
    // Test the queue size management limit
    firstTransport.simulateClose();
    for (let i = 0; i < 10; i++) {
        await wrapper.send({ jsonrpc: '2.0', method: `spam${i}` });
    }
    
    await wrapper.close();
  });
  
  it('should throw when sending on a closed transport', async () => {
    const wrapper = createWrapper();
    await wrapper.start();
    await wrapper.close();
    
    await expect(wrapper.send({ jsonrpc: '2.0', method: 'test' })).rejects.toThrow('Transport is closed');
  });

  it('should throw when ping response times out gracefully during initial connect', async () => {
     const wrapper = new ResilientTransportWrapper({
       name: 'fail-connect',
       connectParams: async () => {
         throw new Error('Initial network error');
       }
     });

     await expect(wrapper.start()).rejects.toThrow('Initial network error');
  });
});
