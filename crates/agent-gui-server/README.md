# agent-gui-server

Desktop GUI automation MCP server — text-based Agents (claude-code, nuwaxcode) call it via MCP protocol to perform screenshot recognition + keyboard/mouse simulation.

## Features

- **14 MCP Tools**: 13 atomic operations + 1 high-level `gui_execute_task`
- **Dual Transport**: Streamable HTTP (primary) + stdio (backup)
- **Agent Loop**: pi-mono Agent with three-layer memory management
- **Multi-Model Coordinate Support**: Anthropic, OpenAI, Google (Gemini yx auto-swap)
- **Safety**: Hotkey blacklist, audit log, stuck detection
- **Cross-Platform**: macOS, Windows, Linux

## Quick Start

```bash
# Install dependencies
pnpm install

# Build
node scripts/build.mjs

# Run (HTTP mode, default port 60008)
GUI_AGENT_API_KEY=sk-ant-xxx node dist/index.js

# Run (custom port)
GUI_AGENT_API_KEY=sk-ant-xxx node dist/index.js --port 8080

# Run (stdio mode)
GUI_AGENT_API_KEY=sk-ant-xxx node dist/index.js --transport stdio
```

## MCP Configuration

### HTTP Mode (Recommended)

```json
{
  "mcpServers": {
    "gui-agent": {
      "url": "http://127.0.0.1:60008/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### stdio Mode

```json
{
  "mcpServers": {
    "gui-agent": {
      "command": "node",
      "args": ["/path/to/agent-gui-server/dist/index.js", "--transport", "stdio"],
      "env": {
        "GUI_AGENT_API_KEY": "sk-ant-xxx"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GUI_AGENT_API_KEY` | Yes | — | LLM API key |
| `GUI_AGENT_PROVIDER` | No | `anthropic` | LLM provider |
| `GUI_AGENT_MODEL` | No | `claude-sonnet-4-20250514` | LLM model name |
| `GUI_AGENT_BASE_URL` | No | — | Custom API base URL |
| `GUI_AGENT_PORT` | No | `60008` | HTTP server port |
| `GUI_AGENT_TRANSPORT` | No | `http` | Transport: `http` or `stdio` |
| `GUI_AGENT_MAX_STEPS` | No | `50` | Max steps per task (1-200) |
| `GUI_AGENT_STEP_DELAY_MS` | No | `1500` | Delay between steps (100-30000ms) |
| `GUI_AGENT_JPEG_QUALITY` | No | `75` | Screenshot JPEG quality (1-100) |
| `GUI_AGENT_DISPLAY_INDEX` | No | `0` | Target display index |
| `GUI_AGENT_STUCK_THRESHOLD` | No | `3` | Consecutive similar screenshots to detect stuck |
| `GUI_AGENT_COORDINATE_MODE` | No | auto | `image-absolute`, `normalized-1000`, `normalized-999`, `percentage` |
| `GUI_AGENT_MEMORY_PROVIDER` | No | — | Memory model provider (defaults to main) |
| `GUI_AGENT_MEMORY_MODEL` | No | — | Memory model name (defaults to main) |
| `GUI_AGENT_LOG_FILE` | No | — | Enable file logging to this path |

## Tools

### Atomic Tools (13)

| Tool | Description |
|------|-------------|
| `gui_screenshot` | Capture screen |
| `gui_click` | Click at (x, y) |
| `gui_double_click` | Double-click at (x, y) |
| `gui_move_mouse` | Move cursor to (x, y) |
| `gui_drag` | Drag from (x1,y1) to (x2,y2) |
| `gui_scroll` | Scroll at (x, y) |
| `gui_type` | Type text (CJK auto-routed via clipboard) |
| `gui_press_key` | Press a single key |
| `gui_hotkey` | Press key combination |
| `gui_cursor_position` | Get cursor position |
| `gui_list_displays` | List connected displays |
| `gui_find_image` | Template matching on screen |
| `gui_wait_for_image` | Wait for image to appear |

### Task Tool (1)

| Tool | Description |
|------|-------------|
| `gui_execute_task` | Execute a natural language GUI task via Agent loop |

`gui_execute_task` accepts a natural language description (e.g., "Open Finder and create a new folder") and uses an LLM-powered Agent to autonomously analyze screenshots and perform actions until the task is complete.

## Resources

| URI | Description |
|-----|-------------|
| `gui://status` | Platform, model, server status |
| `gui://permissions` | Screen recording & accessibility |
| `gui://audit-log` | Recent tool execution log |

## SDK Usage

```typescript
import { createGuiAgentServer } from 'agent-gui-server';
import type { GuiAgentConfig } from 'agent-gui-server';

const server = createGuiAgentServer({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: process.env.API_KEY!,
  port: 60008,
  transport: 'http',
  // ... other options
});

await server.start();
// server.stop() for graceful shutdown
```

## Development

```bash
# Install
pnpm install

# Type check
npx tsc --noEmit

# Run tests
npx vitest run

# Build
node scripts/build.mjs
```

## Architecture

```
src/
├── index.ts              # CLI entry
├── lib.ts                # SDK exports
├── config.ts             # Environment config
├── agent/
│   ├── taskRunner.ts     # pi-mono Agent loop engine
│   ├── memoryManager.ts  # Three-layer memory (summary/recent/pending)
│   ├── stuckDetector.ts  # Screenshot similarity detection
│   └── systemPrompt.ts   # Agent system prompt template
├── coordinates/
│   ├── modelProfiles.ts  # Model → coordinate mode mapping
│   └── resolver.ts       # 4-step coordinate resolution
├── desktop/
│   ├── display.ts        # Display enumeration
│   ├── screenshot.ts     # Capture + resize + JPEG pipeline
│   ├── mouse.ts          # Click/drag/scroll
│   ├── keyboard.ts       # Type/hotkey (CJK clipboard routing)
│   ├── clipboard.ts      # Clipboard backup/restore
│   └── imageSearch.ts    # Template matching
├── mcp/
│   ├── server.ts         # Dual-mode MCP server (HTTP + stdio)
│   ├── atomicTools.ts    # 13 atomic tool handlers
│   ├── taskTools.ts      # gui_execute_task handler + mutex
│   └── resources.ts      # 3 MCP resources
├── safety/
│   ├── hotkeys.ts        # Dangerous hotkey blacklist
│   └── auditLog.ts       # Ring buffer audit log
└── utils/
    ├── errors.ts         # 5 structured error classes
    ├── logger.ts         # stderr + file logging
    └── platform.ts       # Platform detection + permissions
```
