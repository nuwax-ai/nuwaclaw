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
    let healthCheckCalls = 0;
    const wrapper = createWrapper({
      pingIntervalMs: 1000,
      pingTimeoutMs: 500,
      maxConsecutiveFailures: 2,
      reconnectDelayMs: 100,
      healthCheckFn: async () => {
        healthCheckCalls++;
        return false; // Always fail health check
      }
    });

    await wrapper.start();
    wrapper.enableHeartbeat();

    // Trigger first heartbeat failure
    await vi.advanceTimersByTimeAsync(1001);
    await vi.advanceTimersByTimeAsync(10);
    expect(mockTransports.length).toBe(1); // Still same transport

    // Trigger second heartbeat failure (maxConsecutiveFailures = 2)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10);

    // Advance for reconnect delay
    await vi.advanceTimersByTimeAsync(150);

    // Should have reconnected (new transport created)
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

  it('should throw when initial connect fails', async () => {
     const wrapper = new ResilientTransportWrapper({
       name: 'fail-connect',
       reconnectDelayMs: 100,
       connectParams: async () => {
         throw new Error('Initial network error');
       }
     });

     // start() should throw on initial connection failure
     // Caller is responsible for retry logic
     await expect(wrapper.start()).rejects.toThrow('Initial network error');

     // Clean up
     await wrapper.close();
  });

  it('should call healthCheckFn for heartbeat', async () => {
    let healthCheckCalls = 0;
    const wrapper = createWrapper({
      pingIntervalMs: 1000,
      pingTimeoutMs: 500,
      maxConsecutiveFailures: 3,
      reconnectDelayMs: 100,
      healthCheckFn: async () => {
        healthCheckCalls++;
        return true;
      }
    });

    await wrapper.start();
    wrapper.enableHeartbeat();

    // Advance timer to trigger first heartbeat
    await vi.advanceTimersByTimeAsync(1001);
    // Allow async healthCheckFn to complete
    await vi.advanceTimersByTimeAsync(10);

    // healthCheckFn should have been called once
    expect(healthCheckCalls).toBe(1);

    // Advance for another heartbeat
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(healthCheckCalls).toBe(2);

    await wrapper.close();
  });

  it('should trigger reconnect when healthCheckFn fails repeatedly', async () => {
    const wrapper = createWrapper({
      pingIntervalMs: 1000,
      pingTimeoutMs: 500,
      maxConsecutiveFailures: 2,
      reconnectDelayMs: 100,
      healthCheckFn: async () => {
        return false; // Always fail
      }
    });

    await wrapper.start();
    wrapper.enableHeartbeat();

    // Trigger first heartbeat failure
    await vi.advanceTimersByTimeAsync(1001);
    await vi.advanceTimersByTimeAsync(10);
    expect(mockTransports.length).toBe(1); // Still same transport

    // Trigger second heartbeat failure (maxConsecutiveFailures = 2)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10);

    // Advance for reconnect delay
    await vi.advanceTimersByTimeAsync(150);

    // Should have reconnected (new transport created)
    expect(mockTransports.length).toBe(2);

    await wrapper.close();
  });

  it('should trigger onreconnect event on reconnect', async () => {
    let onreconnectCalls = 0;
    const wrapper = createWrapper({ reconnectDelayMs: 100 });

    wrapper.onreconnect = async () => {
      onreconnectCalls++;
    };

    await wrapper.start();

    // Simulate disconnect
    mockTransports[0].simulateClose();

    // Advance time for reconnect
    await vi.advanceTimersByTimeAsync(150);

    // onreconnect should have been called
    expect(onreconnectCalls).toBe(1);
    expect(mockTransports.length).toBe(2);

    await wrapper.close();
  });

  it('should handle onreconnect failure with backoff', async () => {
    let reconnectAttempts = 0;
    const wrapper = createWrapper({ reconnectDelayMs: 100 });

    wrapper.onreconnect = async () => {
      reconnectAttempts++;
      throw new Error('Reconnect handler failed');
    };

    await wrapper.start();

    // Simulate disconnect
    mockTransports[0].simulateClose();

    // Advance time for first reconnect attempt (100ms delay)
    await vi.advanceTimersByTimeAsync(150);
    expect(reconnectAttempts).toBe(1);
    expect(mockTransports.length).toBe(2);

    // onreconnect failed, should retry with backoff (400ms = 100 * 2^2)
    await vi.advanceTimersByTimeAsync(450);
    expect(reconnectAttempts).toBe(2);
    expect(mockTransports.length).toBe(3);

    // Next retry with backoff (800ms = 100 * 2^3)
    await vi.advanceTimersByTimeAsync(850);
    expect(reconnectAttempts).toBe(3);
    expect(mockTransports.length).toBe(4);

    await wrapper.close();
  });

  it('should succeed when onreconnect handler succeeds', async () => {
    let reconnectAttempts = 0;
    const wrapper = createWrapper({ reconnectDelayMs: 100 });

    wrapper.onreconnect = async () => {
      reconnectAttempts++;
      // Success - no throw
    };

    await wrapper.start();

    // Simulate disconnect
    mockTransports[0].simulateClose();

    // Advance time for reconnect
    await vi.advanceTimersByTimeAsync(150);

    // onreconnect should have succeeded
    expect(reconnectAttempts).toBe(1);
    expect(mockTransports.length).toBe(2);

    // No more reconnects should happen
    await vi.advanceTimersByTimeAsync(1000);
    expect(reconnectAttempts).toBe(1);
    expect(mockTransports.length).toBe(2);

    await wrapper.close();
  });

  it('should use transport liveness check when no healthCheckFn provided', async () => {
    const wrapper = createWrapper({
      pingIntervalMs: 1000,
      pingTimeoutMs: 500,
      maxConsecutiveFailures: 2,
      reconnectDelayMs: 100,
      // No healthCheckFn provided
    });

    await wrapper.start();
    wrapper.enableHeartbeat();
    await vi.advanceTimersByTimeAsync(10);

    // Trigger heartbeat - should pass because transport is alive
    await vi.advanceTimersByTimeAsync(1001);

    // Should still be on same transport (health check passed via liveness)
    expect(mockTransports.length).toBe(1);

    await wrapper.close();
  });

  it('should prevent concurrent health check executions', async () => {
    let healthCheckCalls = 0;
    let healthCheckResolve: () => void;
    let healthCheckPromise: Promise<boolean>;

    const wrapper = createWrapper({
      pingIntervalMs: 1000,
      pingTimeoutMs: 5000, // Long timeout to test concurrency
      maxConsecutiveFailures: 3,
      healthCheckFn: async () => {
        healthCheckCalls++;
        // Return a promise that doesn't resolve immediately
        healthCheckPromise = new Promise((resolve) => {
          healthCheckResolve = () => resolve(true);
        });
        return healthCheckPromise;
      }
    });

    await wrapper.start();
    wrapper.enableHeartbeat();

    // Trigger first heartbeat - this will start but not complete
    await vi.advanceTimersByTimeAsync(1001);

    // healthCheckFn should have been called once and is now pending
    expect(healthCheckCalls).toBe(1);

    // Trigger more timers while health check is in progress
    // These should be skipped due to healthCheckInProgress guard
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    // Still only 1 call because the first one hasn't resolved yet
    expect(healthCheckCalls).toBe(1);

    // Now resolve the health check
    healthCheckResolve!();
    await vi.advanceTimersByTimeAsync(10);

    // Now the next heartbeat can run
    await vi.advanceTimersByTimeAsync(1000);
    expect(healthCheckCalls).toBe(2);

    await wrapper.close();
  });

  it('should use response-driven scheduling (setTimeout not setInterval)', async () => {
    let healthCheckCalls = 0;
    const healthCheckTimes: number[] = [];

    const wrapper = createWrapper({
      pingIntervalMs: 1000,
      healthCheckFn: async () => {
        healthCheckCalls++;
        healthCheckTimes.push(Date.now());
        return true;
      }
    });

    await wrapper.start();
    wrapper.enableHeartbeat();

    // Run for 5 heartbeat cycles
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(10); // Allow async to complete
    }

    expect(healthCheckCalls).toBe(5);

    // Verify timing - each check should be ~1000ms apart
    // (not stacked up like setInterval would do if checks were slow)
    for (let i = 1; i < healthCheckTimes.length; i++) {
      const diff = healthCheckTimes[i] - healthCheckTimes[i - 1];
      expect(diff).toBeGreaterThanOrEqual(1000);
    }

    await wrapper.close();
  });

  it('should not schedule next health check when state changes to reconnecting', async () => {
    let healthCheckCalls = 0;

    const wrapper = createWrapper({
      pingIntervalMs: 1000,
      maxConsecutiveFailures: 2,
      reconnectDelayMs: 100,
      healthCheckFn: async () => {
        healthCheckCalls++;
        return false; // Always fail
      }
    });

    await wrapper.start();
    wrapper.enableHeartbeat();

    // Trigger first failure
    await vi.advanceTimersByTimeAsync(1001);
    await vi.advanceTimersByTimeAsync(10);
    expect(healthCheckCalls).toBe(1);

    // Trigger second failure - should trigger reconnect
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(healthCheckCalls).toBe(2);

    // After hitting maxConsecutiveFailures, no more health checks should be scheduled
    // because state is now 'reconnecting'
    const callsBeforeReconnect = healthCheckCalls;

    // Advance time - no new health checks should run during reconnect
    await vi.advanceTimersByTimeAsync(50);
    expect(healthCheckCalls).toBe(callsBeforeReconnect);

    // Complete the reconnect
    await vi.advanceTimersByTimeAsync(100);

    // After reconnect, heartbeat should restart
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(healthCheckCalls).toBeGreaterThan(callsBeforeReconnect);

    await wrapper.close();
  });

  it('should schedule next check in finally block only when connected', async () => {
    let healthCheckCalls = 0;
    let shouldFailHealthCheck = true;

    const wrapper = createWrapper({
      pingIntervalMs: 1000,
      maxConsecutiveFailures: 2,
      reconnectDelayMs: 100,
      healthCheckFn: async () => {
        healthCheckCalls++;
        if (shouldFailHealthCheck) {
          return false;
        }
        return true;
      }
    });

    await wrapper.start();
    wrapper.enableHeartbeat();

    // Trigger failures to cause reconnect
    await vi.advanceTimersByTimeAsync(1001);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10);

    // Now let health checks pass
    shouldFailHealthCheck = false;

    // Complete reconnect
    await vi.advanceTimersByTimeAsync(150);

    // Should be reconnected now
    expect(mockTransports.length).toBe(2);

    // Heartbeat should resume with new transport
    const callsAfterReconnect = healthCheckCalls;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10);

    // New health check should have been scheduled after reconnect
    expect(healthCheckCalls).toBeGreaterThan(callsAfterReconnect);

    await wrapper.close();
  });
});
