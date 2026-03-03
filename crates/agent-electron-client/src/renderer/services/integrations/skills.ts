export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  requiresPermission?: boolean;
  icon?: string;
}

export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  requiresPermission?: boolean;
  permissionDetails?: {
    type: 'command' | 'file' | 'network';
    title: string;
    description: string;
    details: Record<string, unknown>;
  };
}

export interface SkillContext {
  workingDir?: string;
  userId: string;
  sessionId: string;
  requirePermission?: (details: SkillExecutionResult['permissionDetails']) => Promise<boolean>;
}

export interface BaseSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  requiresPermission: boolean;
  execute(input: string, context: SkillContext): Promise<SkillExecutionResult>;
}

// Built-in skills
export const builtInSkills: BaseSkill[] = [];

class WebSearchSkill implements BaseSkill {
  id = 'web-search';
  name = 'Web Search';
  description = 'Search the web for information';
  enabled = true;
  requiresPermission = false;

  async execute(input: string, _context: SkillContext): Promise<SkillExecutionResult> {
    // TODO: Implement web search
    return {
      success: true,
      output: `Search results for: ${input}`,
    };
  }
}

class CalculatorSkill implements BaseSkill {
  id = 'calculator';
  name = 'Calculator';
  description = 'Perform mathematical calculations';
  enabled = true;
  requiresPermission = false;

  async execute(input: string, _context: SkillContext): Promise<SkillExecutionResult> {
    try {
      const sanitized = input.replace(/[^0-9+\-*/.()%]/g, '');
      // eslint-disable-next-line no-new-func
      const result = new Function(`"use strict"; return (${sanitized})`)();
      return {
        success: true,
        output: String(result),
      };
    } catch {
      return {
        success: false,
        error: 'Invalid expression',
      };
    }
  }
}

class FileReadSkill implements BaseSkill {
  id = 'file-read';
  name = 'File Read';
  description = 'Read content from a file';
  enabled = true;
  requiresPermission = true;

  async execute(input: string, context: SkillContext): Promise<SkillExecutionResult> {
    const filePath = input.trim();

    if (context.requirePermission) {
      const approved = await context.requirePermission({
        type: 'file',
        title: 'Read File',
        description: `Read content from file: ${filePath}`,
        details: { file: filePath },
      });

      if (!approved) {
        return {
          success: false,
          error: 'Permission denied',
        };
      }
    }

    return {
      success: true,
      output: `File read: ${filePath}`,
    };
  }
}

class CommandRunSkill implements BaseSkill {
  id = 'command-run';
  name = 'Command Run';
  description = 'Run shell commands';
  enabled = true;
  requiresPermission = true;

  async execute(input: string, context: SkillContext): Promise<SkillExecutionResult> {
    if (context.requirePermission) {
      const approved = await context.requirePermission({
        type: 'command',
        title: 'Run Command',
        description: `Execute shell command: ${input}`,
        details: { command: 'sh', args: ['-c', input], env: {} },
      });

      if (!approved) {
        return {
          success: false,
          error: 'Permission denied',
        };
      }
    }

    return {
      success: true,
      output: `Command would execute: ${input}`,
    };
  }
}

class NetworkFetchSkill implements BaseSkill {
  id = 'network-fetch';
  name = 'Network Fetch';
  description = 'Fetch content from a URL';
  enabled = true;
  requiresPermission = true;

  async execute(input: string, context: SkillContext): Promise<SkillExecutionResult> {
    const url = input.trim();

    if (context.requirePermission) {
      const approved = await context.requirePermission({
        type: 'network',
        title: 'Network Request',
        description: `Fetch content from: ${url}`,
        details: { url },
      });

      if (!approved) {
        return {
          success: false,
          error: 'Permission denied',
        };
      }
    }

    return {
      success: true,
      output: `Would fetch: ${url}`,
    };
  }
}

// Skill manager
class SkillManager {
  private skills: Map<string, BaseSkill> = new Map();

  register(skill: BaseSkill) {
    this.skills.set(skill.id, skill);
  }

  getSkill(id: string): BaseSkill | undefined {
    return this.skills.get(id);
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values()).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      enabled: s.enabled,
      requiresPermission: s.requiresPermission,
    }));
  }

  async executeSkill(
    skillId: string, 
    input: string, 
    context: SkillContext,
    requirePermission?: SkillContext['requirePermission']
  ): Promise<SkillExecutionResult> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: `Skill not found: ${skillId}` };
    }
    if (!skill.enabled) {
      return { success: false, error: `Skill disabled: ${skillId}` };
    }

    const ctx = { ...context, requirePermission };

    // Check if permission is required but not provided
    if (skill.requiresPermission && !requirePermission) {
      const result = await skill.execute(input, ctx);
      return {
        ...result,
        requiresPermission: true,
      };
    }

    return skill.execute(input, ctx);
  }

  async executeAuto(
    input: string, 
    context: SkillContext,
    requirePermission?: SkillContext['requirePermission']
  ): Promise<SkillExecutionResult | null> {
    const lowerInput = input.toLowerCase();

    // Calculator
    if (/^\d+[\s+\-*/%()\d]+$/.test(input.replace(/\s/g, ''))) {
      return this.executeSkill('calculator', input, context, requirePermission);
    }

    // Web search
    if (lowerInput.startsWith('search:') || lowerInput.startsWith('查找:') || lowerInput.startsWith('搜索:')) {
      const query = input.replace(/^(search|查找|搜索):\s*/i, '');
      return this.executeSkill('web-search', query, context, requirePermission);
    }

    // Command (starts with !)
    if (lowerInput.startsWith('!') || lowerInput.startsWith('run:')) {
      const cmd = input.replace(/^(!|run:)\s*/i, '');
      return this.executeSkill('command-run', cmd, context, requirePermission);
    }

    // File read (starts with cat:)
    if (lowerInput.startsWith('cat:')) {
      const file = input.replace(/^cat:\s*/i, '');
      return this.executeSkill('file-read', file, context, requirePermission);
    }

    // Network fetch (starts with fetch:)
    if (lowerInput.startsWith('fetch:') || lowerInput.startsWith('curl:')) {
      const url = input.replace(/^(fetch|curl):\s*/i, '');
      return this.executeSkill('network-fetch', url, context, requirePermission);
    }

    return null;
  }
}

export const skillManager = new SkillManager();

// Register built-in skills
skillManager.register(new WebSearchSkill());
skillManager.register(new CalculatorSkill());
skillManager.register(new FileReadSkill());
skillManager.register(new CommandRunSkill());
skillManager.register(new NetworkFetchSkill());
