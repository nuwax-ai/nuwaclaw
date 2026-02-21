export interface PermissionRequest {
  id: string;
  type: 'tool' | 'command' | 'file' | 'network';
  title: string;
  description: string;
  details: {
    tool?: string;
    command?: string;
    file?: string;
    url?: string;
    args?: string[];
    env?: Record<string, string>;
  };
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'denied';
}

export interface PermissionRule {
  id: string;
  pattern: string; // e.g., "npm:*", "file:~/Documents/*"
  action: 'allow' | 'deny' | 'prompt';
  expiresAt?: number;
}

class PermissionManager {
  private pendingRequests: Map<string, PermissionRequest> = new Map();
  private rules: PermissionRule[] = [];
  private sessionApprovedTools: Map<string, Set<string>> = new Map();

  // Check if action is allowed without prompting
  async checkPermission(request: Omit<PermissionRequest, 'id' | 'timestamp' | 'status'>): Promise<boolean> {
    const key = this.getRuleKey(request);
    
    for (const rule of this.rules) {
      if (this.matchPattern(key, rule.pattern)) {
        if (rule.action === 'allow') return true;
        if (rule.action === 'deny') return false;
        // 'prompt' means we need to ask user
      }
    }

    // Check session-level approvals
    const sessionApproved = this.sessionApprovedTools.get(request.sessionId);
    if (sessionApproved?.has(key)) {
      return true;
    }

    // Default: prompt for sensitive actions
    const sensitiveTypes = ['command', 'file', 'network'];
    if (sensitiveTypes.includes(request.type)) {
      return false;
    }

    return true;
  }

  private getRuleKey(request: Omit<PermissionRequest, 'id' | 'timestamp' | 'status'>): string {
    switch (request.type) {
      case 'tool':
        return `tool:${request.details.tool || ''}`;
      case 'command':
        return `command:${request.details.command || ''}`;
      case 'file':
        return `file:${request.details.file || ''}`;
      case 'network':
        return `network:${request.details.url || ''}`;
      default:
        return 'unknown';
    }
  }

  private matchPattern(key: string, pattern: string): boolean {
    // Simple glob matching
    if (pattern === '*') return true;
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1);
      return key.startsWith(prefix);
    }
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(key);
    }
    return key === pattern;
  }

  // Create a permission request
  createRequest(request: Omit<PermissionRequest, 'id' | 'timestamp' | 'status'>): PermissionRequest {
    const id = crypto.randomUUID();
    const fullRequest: PermissionRequest = {
      ...request,
      id,
      timestamp: Date.now(),
      status: 'pending',
    };
    this.pendingRequests.set(id, fullRequest);
    return fullRequest;
  }

  // Get all pending requests
  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.pendingRequests.values()).filter(r => r.status === 'pending');
  }

  // Approve a request
  approveRequest(requestId: string, alwaysAllow: boolean = false): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) return false;

    request.status = 'approved';

    if (alwaysAllow) {
      // Add session-level approval
      const key = this.getRuleKey(request);
      if (!this.sessionApprovedTools.has(request.sessionId)) {
        this.sessionApprovedTools.set(request.sessionId, new Set());
      }
      this.sessionApprovedTools.get(request.sessionId)?.add(key);
    }

    return true;
  }

  // Deny a request
  denyRequest(requestId: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) return false;
    request.status = 'denied';
    return true;
  }

  // Add a rule
  addRule(rule: Omit<PermissionRule, 'id'>): void {
    this.rules.push({ ...rule, id: crypto.randomUUID() });
  }

  // Get rules
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  // Clear rules
  clearRules(): void {
    this.rules = [];
  }

  // Load rules from storage
  async loadRules(rules: PermissionRule[]): Promise<void> {
    this.rules = rules;
  }

  // Export rules for storage
  exportRules(): PermissionRule[] {
    return this.rules;
  }

  // Clear session approvals
  clearSessionApprovals(sessionId: string): void {
    this.sessionApprovedTools.delete(sessionId);
  }
}

export const permissionManager = new PermissionManager();
