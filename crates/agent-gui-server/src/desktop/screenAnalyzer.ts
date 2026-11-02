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

const SCREEN_ANALYSIS_SYSTEM_PROMPT = `You are a GUI screen analysis assistant specialized in desktop automation.

Your task is to analyze screenshots and provide actionable information for automation tasks.

When analyzing the screen:
1. Identify UI elements: buttons, menus, input fields, icons, windows, dialogs
2. Provide approximate coordinates when asked (as percentages like "top-left quadrant" or pixel estimates)
3. Describe element states: enabled/disabled, focused, selected, minimized, etc.
4. Read visible text content accurately
5. Identify the active application and window focus

Be concise but thorough. Format your response clearly with:
- Element descriptions
- Locations (when relevant)
- States and any actionable details

If the user asks about specific elements, locate them precisely and describe their position relative to the screen or window.`;

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
      systemPrompt: SCREEN_ANALYSIS_SYSTEM_PROMPT,
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
