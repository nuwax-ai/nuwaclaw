/**
 * Shared LLM API Client
 *
 * Unified LLM API client used by ExtractionQueue and MemoryScheduler.
 * Supports both Anthropic and OpenAI-compatible APIs.
 */

import log from 'electron-log';

export interface LlmCallOptions {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
}

/**
 * Call LLM API (supports Anthropic and OpenAI-compatible)
 *
 * @param prompt - The prompt to send
 * @param options - Provider, model, API key, and optional settings
 * @returns The text response from the LLM
 */
export async function callLlmApi(
  prompt: string,
  options: LlmCallOptions
): Promise<string> {
  const { provider, model, apiKey, baseUrl, maxTokens = 800 } = options;

  const isAnthropic = provider.toLowerCase().includes('anthropic') ||
                      model.toLowerCase().includes('claude');

  if (isAnthropic) {
    return callAnthropicApi(prompt, apiKey, baseUrl, model, maxTokens);
  } else {
    return callOpenAiApi(prompt, apiKey, baseUrl, model, maxTokens);
  }
}

/**
 * Call Anthropic Messages API
 */
async function callAnthropicApi(
  prompt: string,
  apiKey: string,
  baseUrl: string | undefined,
  model: string,
  maxTokens: number
): Promise<string> {
  const url = baseUrl ?? 'https://api.anthropic.com/v1/messages';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: maxTokens,
      messages: [
        { role: 'user', content: prompt }
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json() as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? '';
}

/**
 * Call OpenAI-compatible Chat Completions API
 */
async function callOpenAiApi(
  prompt: string,
  apiKey: string,
  baseUrl: string | undefined,
  model: string,
  maxTokens: number
): Promise<string> {
  const url = baseUrl ?? 'https://api.openai.com/v1/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages: [
        { role: 'user', content: prompt }
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}
