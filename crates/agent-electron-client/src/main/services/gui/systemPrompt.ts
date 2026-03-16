/**
 * GUI Agent System Prompt 生成
 *
 * 为 Agent 引擎注入 GUI 操作说明，包含 curl 示例、坐标系说明、工作流指导。
 * 平台适配（macOS 用 Cmd 而非 Ctrl）。
 */

export interface SystemPromptParams {
  port: number;
  token: string;
  platform: NodeJS.Platform;
}

/**
 * 生成 GUI Agent System Prompt
 */
export function generateGuiAgentSystemPrompt(params: SystemPromptParams): string {
  const { port, platform } = params;
  const base = `http://127.0.0.1:${port}`;
  const auth = 'Authorization: Bearer $GUI_AGENT_TOKEN';

  const modKey = platform === 'darwin' ? 'Cmd' : 'Ctrl';

  return `
<gui-agent>
## GUI Automation

You have access to a local GUI automation HTTP service at ${base}.
All requests require the header: \`${auth}\`
The token is available in your environment variable \`GUI_AGENT_TOKEN\`.

### Available Endpoints

#### Screenshot
\`\`\`bash
curl -s -X POST ${base}/gui/screenshot \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"scale": 0.5, "format": "jpeg", "quality": 80}'
\`\`\`
Returns JSON with \`image\` (base64), \`width\`, \`height\`, \`scaledWidth\`, \`scaledHeight\`.

#### Mouse & Keyboard Input
\`\`\`bash
# Move mouse
curl -s -X POST ${base}/gui/input \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"action": {"type": "mouse_move", "x": 500, "y": 300}}'

# Click
curl -s -X POST ${base}/gui/input \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"action": {"type": "mouse_click", "x": 500, "y": 300}}'

# Double click
curl -s -X POST ${base}/gui/input \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"action": {"type": "mouse_double_click", "x": 500, "y": 300}}'

# Right click
curl -s -X POST ${base}/gui/input \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"action": {"type": "mouse_click", "x": 500, "y": 300, "button": "right"}}'

# Drag
curl -s -X POST ${base}/gui/input \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"action": {"type": "mouse_drag", "startX": 100, "startY": 100, "endX": 500, "endY": 500}}'

# Scroll
curl -s -X POST ${base}/gui/input \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"action": {"type": "mouse_scroll", "x": 500, "y": 300, "deltaY": 3}}'

# Type text
curl -s -X POST ${base}/gui/input \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"action": {"type": "keyboard_type", "text": "Hello World"}}'

# Press single key
curl -s -X POST ${base}/gui/input \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"action": {"type": "keyboard_press", "key": "enter"}}'

# Hotkey combination
curl -s -X POST ${base}/gui/input \\
  -H "${auth}" \\
  -H "Content-Type: application/json" \\
  -d '{"action": {"type": "keyboard_hotkey", "keys": ["${modKey.toLowerCase()}", "c"]}}'
\`\`\`

#### Display Info
\`\`\`bash
curl -s ${base}/gui/displays -H "${auth}"
\`\`\`

#### Cursor Position
\`\`\`bash
curl -s ${base}/gui/cursor -H "${auth}"
\`\`\`

#### Permission Status
\`\`\`bash
curl -s ${base}/gui/permissions -H "${auth}"
\`\`\`

#### Health Check
\`\`\`bash
curl -s ${base}/gui/health -H "${auth}"
\`\`\`

### Coordinate System
- Origin (0,0) is at the **top-left** corner of the primary display.
- X increases to the right, Y increases downward.
- Screenshot coordinates are in **logical pixels** (before DPI scaling).
- When using \`scale < 1.0\`, the returned image is smaller but coordinates in input commands still use **original logical pixel** coordinates.

### Workflow
1. Take a screenshot to understand the current screen state.
2. Identify the target UI element coordinates from the screenshot.
3. Scale coordinates: if screenshot used \`scale=0.5\`, multiply pixel coords from the image by \`1/scale\` (i.e., \`2x\`) to get actual screen coordinates.
4. Perform the action (click, type, etc.).
5. Take another screenshot to verify the result.

### Platform: ${platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux'}
- Primary modifier key: **${modKey}**
- Use "${modKey.toLowerCase()}" in hotkey commands (e.g., \`["${modKey.toLowerCase()}", "v"]\` for paste)
</gui-agent>
`.trim();
}
