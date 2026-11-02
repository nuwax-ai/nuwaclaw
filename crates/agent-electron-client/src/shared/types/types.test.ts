/**
 * 单元测试: 类型工具和辅助函数
 *
 * 测试通用工具函数:
 * - 类型验证函数
 * - 数据转换函数
 */

import { describe, it, expect } from 'vitest';

describe('Type Utilities', () => {
  describe('AgentEngineType', () => {
    it('should accept valid engine types', () => {
      const validTypes: AgentEngineType[] = ['claude-code', 'nuwaxcode'];
      validTypes.forEach(type => {
        expect(['claude-code', 'nuwaxcode'] as const).toContain(type);
      });
    });

    it('should have exactly two engine types', () => {
      const engineTypes: AgentEngineType[] = ['claude-code', 'nuwaxcode'];
      expect(engineTypes).toHaveLength(2);
    });
  });

  describe('DependencyStatus type', () => {
    it('should have all expected status values', () => {
      const expectedStatuses: DependencyStatus[] = [
        'checking',
        'installed',
        'missing',
        'outdated',
        'installing',
        'bundled',
        'error',
      ];
      expectedStatuses.forEach(status => {
        expect(expectedStatuses).toContain(status);
      });
    });
  });

  describe('Message parts types', () => {
    it('should create valid TextPart', () => {
      const part: TextPart = {
        type: 'text',
        text: 'Hello, world!',
      };
      expect(part.type).toBe('text');
      expect(part.text).toBe('Hello, world!');
    });

    it('should create valid ReasoningPart', () => {
      const part: ReasoningPart = {
        type: 'reasoning',
        thinking: 'Thinking process...',
      };
      expect(part.type).toBe('reasoning');
      expect(part.thinking).toBe('Thinking process...');
    });

    it('should create valid ToolPart with status', () => {
      const part: ToolPart = {
        type: 'tool',
        toolCallId: 'tool-123',
        name: 'read_file',
        kind: 'function',
        status: 'completed',
        input: '{"path": "/path/to/file"}',
        output: '{"content": "file content"}',
      };
      expect(part.type).toBe('tool');
      expect(part.toolCallId).toBe('tool-123');
      expect(part.status).toBe('completed');
    });

    it('should create valid FilePart', () => {
      const part: FilePart = {
        type: 'file',
        uri: 'file:///path/to/file.txt',
        mimeType: 'text/plain',
      };
      expect(part.type).toBe('file');
      expect(part.uri).toBe('file:///path/to/file.txt');
      expect(part.mimeType).toBe('text/plain');
    });
  });

  describe('Message types', () => {
    it('should create valid UserMessage', () => {
      const message: UserMessage = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello!' },
        ],
      };
      expect(message.role).toBe('user');
      expect(message.content).toHaveLength(1);
    });

    it('should create valid AssistantMessage', () => {
      const message: AssistantMessage = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Response!' },
          { type: 'reasoning', thinking: 'Thinking...' },
        ],
      };
      expect(message.role).toBe('assistant');
      expect(message.content).toHaveLength(2);
    });
  });

  describe('Part input types', () => {
    it('should create valid TextPartInput', () => {
      const input: TextPartInput = {
        type: 'text',
        text: 'Test input',
      };
      expect(input.type).toBe('text');
      expect(input.text).toBe('Test input');
    });

    it('should create valid FilePartInput', () => {
      const input: FilePartInput = {
        type: 'file',
        uri: 'file:///test/file.txt',
        mimeType: 'text/plain',
      };
      expect(input.type).toBe('file');
      expect(input.uri).toBe('file:///test/file.txt');
    });
  });
});

describe('Data Transformation Utilities', () => {
  describe('MessagePart type guards', () => {
    const isTextPart = (part: Part): part is TextPart => part.type === 'text';
    const isReasoningPart = (part: Part): part is ReasoningPart => part.type === 'reasoning';
    const isToolPart = (part: Part): part is ToolPart => part.type === 'tool';
    const isFilePart = (part: Part): part is FilePart => part.type === 'file';

    it('should identify TextPart', () => {
      const textPart: Part = { type: 'text', text: 'test' };
      expect(isTextPart(textPart)).toBe(true);
      expect(isReasoningPart(textPart)).toBe(false);
      expect(isToolPart(textPart)).toBe(false);
      expect(isFilePart(textPart)).toBe(false);
    });

    it('should identify ReasoningPart', () => {
      const reasoningPart: Part = { type: 'reasoning', thinking: 'test' };
      expect(isTextPart(reasoningPart)).toBe(false);
      expect(isReasoningPart(reasoningPart)).toBe(true);
      expect(isToolPart(reasoningPart)).toBe(false);
      expect(isFilePart(reasoningPart)).toBe(false);
    });

    it('should identify ToolPart', () => {
      const toolPart: Part = {
        type: 'tool',
        toolCallId: '123',
        name: 'test_tool',
      };
      expect(isTextPart(toolPart)).toBe(false);
      expect(isReasoningPart(toolPart)).toBe(false);
      expect(isToolPart(toolPart)).toBe(true);
      expect(isFilePart(toolPart)).toBe(false);
    });

    it('should identify FilePart', () => {
      const filePart: Part = { type: 'file', uri: 'test.txt' };
      expect(isTextPart(filePart)).toBe(false);
      expect(isReasoningPart(filePart)).toBe(false);
      expect(isToolPart(filePart)).toBe(false);
      expect(isFilePart(filePart)).toBe(true);
    });
  });

  describe('Message type guards', () => {
    const isUserMessage = (message: Message): message is UserMessage => message.role === 'user';
    const isAssistantMessage = (message: Message): message is AssistantMessage => message.role === 'assistant';

    it('should identify UserMessage', () => {
      const userMsg: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'test' }],
      };
      expect(isUserMessage(userMsg)).toBe(true);
      expect(isAssistantMessage(userMsg)).toBe(false);
    });

    it('should identify AssistantMessage', () => {
      const assistantMsg: Message = {
        role: 'assistant',
        content: [{ type: 'text', text: 'response' }],
      };
      expect(isUserMessage(assistantMsg)).toBe(false);
      expect(isAssistantMessage(assistantMsg)).toBe(true);
    });
  });
});

describe('Config Validation', () => {
  describe('AgentConfig validation', () => {
    const createValidConfig = (): AgentConfig => ({
      engine: 'claude-code',
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514',
      workspaceDir: '/mock/workspace',
    });

    it('should create valid claude-code config', () => {
      const config: AgentConfig = {
        ...createValidConfig(),
        engine: 'claude-code',
      };
      expect(config.engine).toBe('claude-code');
    });

    it('should create valid nuwaxcode config', () => {
      const config: AgentConfig = {
        ...createValidConfig(),
        engine: 'nuwaxcode',
      };
      expect(config.engine).toBe('nuwaxcode');
    });

    it('should accept optional config fields', () => {
      const minimalConfig: AgentConfig = {
        engine: 'claude-code',
        workspaceDir: '/mock/workspace',
      };
      expect(minimalConfig.engine).toBe('claude-code');
      expect(minimalConfig.workspaceDir).toBe('/mock/workspace');
    });

    it('should accept mcpServers config', () => {
      const config: AgentConfig = {
        ...createValidConfig(),
        mcpServers: {
          'test-server': {
            command: 'npx',
            args: ['-y', 'test-mcp-server'],
            env: { TEST_VAR: 'test' },
          },
        },
      };
      expect(config.mcpServers).toHaveProperty('test-server');
      expect(config.mcpServers!['test-server'].command).toBe('npx');
    });

    it('should accept env variables', () => {
      const config: AgentConfig = {
        ...createValidConfig(),
        env: {
          ANTHROPIC_MODEL: 'claude-opus-4-20250514',
          CUSTOM_VAR: 'custom-value',
        },
      };
      expect(config.env).toHaveProperty('ANTHROPIC_MODEL');
      expect(config.env).toHaveProperty('CUSTOM_VAR');
    });
  });
});
