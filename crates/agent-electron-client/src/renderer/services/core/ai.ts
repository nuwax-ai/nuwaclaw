import Anthropic from '@anthropic-ai/sdk';

export interface AIConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: Message[];
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  onChunk?: (text: string) => void;
}

class AIService {
  private client: Anthropic | null = null;
  private config: AIConfig | null = null;

  configure(config: AIConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async chat(options: ChatOptions): Promise<string> {
    if (!this.client || !this.config) {
      throw new Error('AI service not configured');
    }

    const model = options.model || this.config.model;
    const system = options.systemPrompt || 'You are a helpful AI assistant.';

    const response = await this.client.messages.create({
      model,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096,
      system,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  async *streamChat(options: ChatOptions): AsyncGenerator<string> {
    if (!this.client || !this.config) {
      throw new Error('AI service not configured');
    }

    const model = options.model || this.config.model;
    const system = options.systemPrompt || 'You are a helpful AI assistant.';

    const response = await this.client.messages.create({
      model,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096,
      system,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    });

    // @ts-ignore - streaming response
    for await (const chunk of response) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield chunk.delta.text;
      }
    }
  }
}

export const aiService = new AIService();
