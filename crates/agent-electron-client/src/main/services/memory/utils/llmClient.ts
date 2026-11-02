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
  apiProtocol?: string;  // 'anthropic' or 'openai' - explicitly specify API protocol
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
  const { provider, model, apiKey, baseUrl, maxTokens = 800, apiProtocol } = options;

  // Determine API protocol:
  // Only use apiProtocol field to determine the protocol
  // If apiProtocol is not provided, default to OpenAI-compatible format
  const isAnthropic = apiProtocol?.toLowerCase() === 'anthropic';
  log.info('[llmClient] apiProtocol=' + (apiProtocol ?? 'undefined') + ' -> isAnthropic=' + isAnthropic);

  log.info('[llmClient] callLlmApi: provider=' + provider + ', model=' + model +
    ', baseUrl=' + (baseUrl ?? 'default') + ', isAnthropic=' + isAnthropic);

  try {
    if (isAnthropic) {
      const result = await callAnthropicApi(prompt, apiKey, baseUrl, model, maxTokens);
      log.info('[llmClient] Anthropic response length: ' + result.length);
      return result;
    } else {
      const result = await callOpenAiApi(prompt, apiKey, baseUrl, model, maxTokens);
      log.info('[llmClient] OpenAI response length: ' + result.length);
      return result;
    }
  } catch (error) {
    log.error('[llmClient] API call failed:', error);
    throw error;
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
  // Build URL: if baseUrl doesn't end with /v1/messages, append it
  let url = baseUrl ?? 'https://api.anthropic.com/v1/messages';
  if (baseUrl && !baseUrl.endsWith('/v1/messages') && !baseUrl.endsWith('/v1/messages/')) {
    // Remove trailing slash and append /v1/messages
    url = baseUrl.replace(/\/$/, '') + '/v1/messages';
  }

  const requestBody = {
    model: model || 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens,
    messages: [
      { role: 'user', content: prompt }
    ],
  };

  log.info('[llmClient] Calling Anthropic API: ' + url);
  log.info('[llmClient] Request body: model=' + requestBody.model + ', max_tokens=' + requestBody.max_tokens + ', prompt_length=' + prompt.length);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error('[llmClient] Anthropic API error: ' + response.status + ' - ' + errorText);
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as Record<string, unknown>;
  log.info('[llmClient] Anthropic response structure: ' + JSON.stringify(data).slice(0, 200));

  // Handle proxy server error responses (HTTP 200 with error body)
  // e.g., {"code":500,"msg":"404 NOT_FOUND","success":false}
  if ('success' in data && data.success === false) {
    const errorMsg = (data.msg as string) || (data.code ? `Error code: ${data.code}` : 'Unknown proxy error');
    log.error('[llmClient] Proxy server error: ' + errorMsg);
    throw new Error(`Proxy server error: ${errorMsg}`);
  }
  if ('code' in data && typeof data.code === 'number' && data.code >= 400) {
    const errorMsg = (data.msg as string) || `Error code: ${data.code}`;
    log.error('[llmClient] API returned error code: ' + errorMsg);
    throw new Error(`API error: ${errorMsg}`);
  }

  // Standard Anthropic response format
  const anthropicData = data as { content?: Array<{ text?: string }> };
  return anthropicData.content?.[0]?.text ?? '';
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
  // Build URL: if baseUrl doesn't contain /chat/completions, append it
  // Note: Use /chat/completions (not /v1/chat/completions) because:
  // - For official OpenAI API, baseUrl should be provided as "https://api.openai.com/v1"
  // - For proxy servers, they typically expect path like "/api/proxy/model/chat/completions"
  let url = baseUrl ?? 'https://api.openai.com/v1/chat/completions';
  if (baseUrl && !baseUrl.includes('/chat/completions')) {
    // Remove trailing slash and append /chat/completions
    url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  }

  log.info('[llmClient] Calling OpenAI API: ' + url);

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
    const errorText = await response.text();
    log.error('[llmClient] OpenAI API error: ' + response.status + ' - ' + errorText);
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as Record<string, unknown>;
  log.info('[llmClient] OpenAI response structure: ' + JSON.stringify(data).slice(0, 200));

  // Handle proxy server error responses (HTTP 200 with error body)
  // e.g., {"code":500,"msg":"404 NOT_FOUND","success":false}
  if ('success' in data && data.success === false) {
    const errorMsg = (data.msg as string) || (data.code ? `Error code: ${data.code}` : 'Unknown proxy error');
    log.error('[llmClient] Proxy server error: ' + errorMsg);
    throw new Error(`Proxy server error: ${errorMsg}`);
  }
  if ('code' in data && typeof data.code === 'number' && data.code >= 400) {
    const errorMsg = (data.msg as string) || `Error code: ${data.code}`;
    log.error('[llmClient] API returned error code: ' + errorMsg);
    throw new Error(`API error: ${errorMsg}`);
  }

  // Standard OpenAI response format
  const openaiData = data as { choices?: Array<{ message?: { content?: string } }> };
  return openaiData.choices?.[0]?.message?.content ?? '';
}
