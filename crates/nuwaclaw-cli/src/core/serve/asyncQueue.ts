/** Minimal FIFO async queue: push() never blocks, next() awaits until an item is available. */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T) => void> = [];
  private closed = false;

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  /** Resolves with undefined once close() has been called and the queue is drained. */
  async next(): Promise<T | undefined> {
    if (this.items.length > 0) return this.items.shift();
    if (this.closed) return undefined;
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(undefined as unknown as T);
    }
  }
}
