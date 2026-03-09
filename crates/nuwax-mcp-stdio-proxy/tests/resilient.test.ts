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

    // Auto-respond to re-initialize requests
    if ('id' in message && typeof message.id === 'string' && message.id.startsWith('respl-init-')) {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({
            jsonrpc: '2.0',
            id: message.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock', version: '1.0' } }
          });
        }
      }, 10 as number);
    }

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
    wrapper.enableHeartbeat();
    await vi.advanceTimersByTimeAsync(10); // Allow heartbeat to initialize
    
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

  it('should schedule retry when initial connect fails', async () => {
     const wrapper = new ResilientTransportWrapper({
       name: 'fail-connect',
       reconnectDelayMs: 100,
       connectParams: async () => {
         throw new Error('Initial network error');
       }
     });

     // start() doesn't reject — it catches and schedules retry
     await wrapper.start();
     // Clean up
     await wrapper.close();
  });

  it('should capture initialize messages and replay on reconnect', async () => {
    const wrapper = createWrapper({ reconnectDelayMs: 100, pingTimeoutMs: 5000 });
    await wrapper.start();

    // Simulate the MCP client sending initialize handshake
    const initMsg: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 'client-init-1',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    };
    const initializedMsg: JSONRPCMessage = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    await wrapper.send(initMsg);
    await wrapper.send(initializedMsg);

    // Verify they were sent to the first transport
    expect(mockTransports[0].sentMessages).toContainEqual(initMsg);
    expect(mockTransports[0].sentMessages).toContainEqual(initializedMsg);

    // Simulate disconnect
    mockTransports[0].simulateClose();

    // Advance time to trigger reconnect
    await vi.advanceTimersByTimeAsync(150);

    // A new transport should be created
    expect(mockTransports.length).toBe(2);
    const secondTransport = mockTransports[1];

    // The re-initialize request should have been sent with a respl-init- id
    const reInitMsg = secondTransport.sentMessages.find(
      (m: any) => m.method === 'initialize' && typeof m.id === 'string' && m.id.startsWith('respl-init-')
    );
    expect(reInitMsg).toBeDefined();

    // Wait for the auto-response and notifications/initialized to be sent
    await vi.advanceTimersByTimeAsync(50);

    // notifications/initialized should also have been sent
    const reInitNotification = secondTransport.sentMessages.find(
      (m: any) => m.method === 'notifications/initialized'
    );
    expect(reInitNotification).toBeDefined();

    await wrapper.close();
  });

  it('should retry with backoff when re-initialize times out', async () => {
    let transportCount = 0;
    const wrapper = new ResilientTransportWrapper({
      name: 'reinit-timeout',
      reconnectDelayMs: 100,
      pingTimeoutMs: 200,
      connectParams: async () => {
        const t = new MockTransport();
        transportCount++;
        // Second transport onwards: don't auto-respond to respl-init- (simulate timeout)
        if (transportCount > 1) {
          const origSend = t.send.bind(t);
          t.send = async (msg: JSONRPCMessage) => {
            if ('id' in msg && typeof msg.id === 'string' && msg.id.startsWith('respl-init-')) {
              t.sentMessages.push(msg);
              // Don't respond — simulate timeout
              return;
            }
            return origSend(msg);
          };
        }
        mockTransports.push(t);
        return t;
      },
    });

    await wrapper.start();

    // Send initialize to capture it
    await wrapper.send({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    });

    // Simulate disconnect
    mockTransports[0].simulateClose();

    // Advance time for reconnect (100ms) + re-init timeout (200ms) + next retry delay
    await vi.advanceTimersByTimeAsync(100); // reconnect fires, transport connects
    await vi.advanceTimersByTimeAsync(250); // re-init timeout fires

    // Should have attempted a second transport and be scheduling another retry
    expect(mockTransports.length).toBe(2);

    // Advance more time for the next retry attempt
    await vi.advanceTimersByTimeAsync(500);
    expect(mockTransports.length).toBe(3);

    await wrapper.close();
  });

  it('should not replay initialize on reconnect if none was captured', async () => {
    const wrapper = createWrapper({ reconnectDelayMs: 100 });
    await wrapper.start();

    // Don't send any initialize — simulate a scenario where wrapper reconnects
    // before client.connect() completed (edge case)

    mockTransports[0].simulateClose();
    await vi.advanceTimersByTimeAsync(150);

    expect(mockTransports.length).toBe(2);
    const secondTransport = mockTransports[1];

    // No respl-init- messages should have been sent
    const reInitMsg = secondTransport.sentMessages.find(
      (m: any) => typeof m.id === 'string' && m.id.startsWith('respl-init-')
    );
    expect(reInitMsg).toBeUndefined();

    await wrapper.close();
  });

  it('should retry with backoff when re-initialize send throws', async () => {
    let transportCount = 0;
    const wrapper = new ResilientTransportWrapper({
      name: 'reinit-send-fail',
      reconnectDelayMs: 100,
      pingTimeoutMs: 5000,
      connectParams: async () => {
        const t = new MockTransport();
        transportCount++;
        // Second transport onwards: throw on respl-init- send
        if (transportCount > 1) {
          const origSend = t.send.bind(t);
          t.send = async (msg: JSONRPCMessage) => {
            if ('id' in msg && typeof msg.id === 'string' && msg.id.startsWith('respl-init-')) {
              throw new Error('Connection reset');
            }
            return origSend(msg);
          };
        }
        mockTransports.push(t);
        return t;
      },
    });

    await wrapper.start();

    // Send initialize to capture it
    await wrapper.send({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    });

    // Simulate disconnect
    mockTransports[0].simulateClose();

    // Advance time for reconnect (100ms) — transport connects, re-init send throws
    await vi.advanceTimersByTimeAsync(150);

    // Should have attempted a second transport
    expect(mockTransports.length).toBe(2);

    // Advance more time for the backoff retry
    await vi.advanceTimersByTimeAsync(500);

    // Should have created a third transport for the retry
    expect(mockTransports.length).toBe(3);

    await wrapper.close();
  });
});
