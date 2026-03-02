/**
 * Unit tests: filter.ts — tool filtering
 */

import { describe, it, expect } from 'vitest';
import { filterTools } from '../src/filter.js';
import type { ToolFilter } from '../src/filter.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool: ${name}`,
    inputSchema: { type: 'object' as const, properties: {} },
  };
}

const toolA = makeTool('tool-a');
const toolB = makeTool('tool-b');
const toolC = makeTool('tool-c');
const allTools = [toolA, toolB, toolC];

describe('filterTools', () => {
  it('returns all tools when filter is empty', () => {
    const result = filterTools(allTools, {});
    expect(result).toEqual(allTools);
  });

  it('returns all tools when allowTools is an empty set', () => {
    const result = filterTools(allTools, { allowTools: new Set() });
    expect(result).toEqual(allTools);
  });

  it('returns all tools when denyTools is an empty set', () => {
    const result = filterTools(allTools, { denyTools: new Set() });
    expect(result).toEqual(allTools);
  });

  it('filters by allowTools — only matching tools returned', () => {
    const filter: ToolFilter = { allowTools: new Set(['tool-a', 'tool-c']) };
    const result = filterTools(allTools, filter);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(['tool-a', 'tool-c']);
  });

  it('filters by denyTools — matching tools excluded', () => {
    const filter: ToolFilter = { denyTools: new Set(['tool-b']) };
    const result = filterTools(allTools, filter);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(['tool-a', 'tool-c']);
  });

  it('allowTools takes precedence over denyTools', () => {
    const filter: ToolFilter = {
      allowTools: new Set(['tool-a']),
      denyTools: new Set(['tool-a']),
    };
    const result = filterTools(allTools, filter);
    // allowTools wins — tool-a is allowed
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('tool-a');
  });

  it('returns empty array when no tools match allowTools', () => {
    const filter: ToolFilter = { allowTools: new Set(['nonexistent']) };
    const result = filterTools(allTools, filter);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when all tools match denyTools', () => {
    const filter: ToolFilter = { denyTools: new Set(['tool-a', 'tool-b', 'tool-c']) };
    const result = filterTools(allTools, filter);
    expect(result).toHaveLength(0);
  });

  it('handles empty tools array', () => {
    const filter: ToolFilter = { allowTools: new Set(['tool-a']) };
    const result = filterTools([], filter);
    expect(result).toHaveLength(0);
  });
});
