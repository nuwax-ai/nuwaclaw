/**
 * Ring buffer audit log for tracking tool executions.
 */

export interface AuditEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  durationMs?: number;
}

const MAX_ENTRIES = 1000;

export class AuditLog {
  private entries: AuditEntry[] = [];
  private head: number = 0;
  private size: number = 0;

  constructor() {
    this.entries = new Array(MAX_ENTRIES);
  }

  record(entry: Omit<AuditEntry, 'timestamp'>): void {
    const full: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    this.entries[this.head] = full;
    this.head = (this.head + 1) % MAX_ENTRIES;
    if (this.size < MAX_ENTRIES) this.size++;
  }

  /**
   * Get recent entries, most recent first.
   */
  getEntries(count?: number): AuditEntry[] {
    const n = Math.min(count ?? this.size, this.size);
    const result: AuditEntry[] = [];
    for (let i = 0; i < n; i++) {
      const idx = (this.head - 1 - i + MAX_ENTRIES) % MAX_ENTRIES;
      result.push(this.entries[idx]);
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }

  get length(): number {
    return this.size;
  }
}
