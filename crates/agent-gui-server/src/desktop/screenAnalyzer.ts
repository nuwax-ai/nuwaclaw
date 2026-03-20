/**
 * Screen analysis using vision model.
 *
 * Captures screenshot and sends to vision model for analysis.
 */

import { complete } from '@mariozechner/pi-ai';
import type { Model, Api } from '@mariozechner/pi-ai';
import { captureScreenshot } from './screenshot.js';
import { DesktopError } from '../utils/errors.js';

export interface AnalyzeResult {
  analysis: string;
  imageWidth: number;
  imageHeight: number;
}

/**
 * Capture screenshot and analyze with vision model.
 *
 * @param model - The vision model to use
 * @param apiKey - API key for the model
 * @param prompt - Analysis instruction (e.g., "What buttons are visible?")
 * @param displayIndex - Display to capture (default: 0)
 */
export async function analyzeScreen(
  model: Model<Api>,
  apiKey: string,
  prompt: string,
  displayIndex: number = 0,
): Promise<AnalyzeResult> {
  try {
    // Capture screenshot
    const screenshot = await captureScreenshot(displayIndex);

    // Build message with image
    const messages = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'image' as const,
            data: screenshot.image,
            mimeType: screenshot.mimeType,
          },
          {
            type: 'text' as const,
            text: prompt,
          },
        ],
        timestamp: Date.now(),
      },
    ];

    // Call vision model using pi-ai complete function
    const response = await complete(model, {
      systemPrompt: 'You are a screen analysis assistant. Analyze the screenshot and answer the user\'s question accurately and concisely.',
      messages,
    }, {
      apiKey,
    });

    // Extract text from response
    let analysis = '';
    if (response && response.content) {
      for (const part of response.content) {
        if (part.type === 'text') {
          analysis += part.text;
        }
      }
    }

    return {
      analysis,
      imageWidth: screenshot.imageWidth,
      imageHeight: screenshot.imageHeight,
    };
  } catch (err) {
    throw new DesktopError('screenAnalyzer.analyze', err instanceof Error ? err : new Error(String(err)));
  }
}
