/*
 * Tests for MentionPopup (@-skill picker).
 *
 * Vitest runs in a `node` environment (no jsdom available in this workspace),
 * so dynamic effects-driven behaviour is exercised via the pure
 * `fetchSkillsForTab` helper while layout/structural assertions go through
 * `renderToStaticMarkup`. That mirrors the testing strategy of
 * variableForm.test.tsx / markdownRenderer.test.tsx.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { MentionPopup } from '../src/components/MentionPopup';
import { MentionPopupItem } from '../src/components/MentionPopup/Item';
import { fetchSkillsForTab } from '../src/components/MentionPopup/useMentionSearch';
import type {
  WorkbenchApiAdapter,
  WorkbenchSkillListParams,
  WorkbenchSkillListResult,
  WorkbenchSkillOption,
} from '../src/types';

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

const SAMPLE_SKILLS: WorkbenchSkillOption[] = [
  {
    id: 'skill-1',
    name: 'Generate slides',
    description: 'Build a PPT from a prompt',
    icon: 'https://example.test/icon-1.png',
  },
  {
    id: 'skill-2',
    name: 'Summarize docs',
    description: 'Summarize the active document',
  },
];

function noopAdapter(): WorkbenchApiAdapter {
  return {
    async listConversations() {
      return [];
    },
    async createConversation() {
      return {
        id: 'c1',
        agentId: 'a1',
        title: '',
        createdAt: '',
        updatedAt: '',
      };
    },
    async getConversation() {
      return {
        conversation: {
          id: 'c1',
          agentId: 'a1',
          title: '',
          createdAt: '',
          updatedAt: '',
        },
        messages: [],
      };
    },
    async *sendMessage() {
      // no-op
    },
  };
}

describe('MentionPopup', () => {
  it('renders null when open=false', () => {
    const html = render(
      <MentionPopup
        open={false}
        agentId="agent-1"
        adapter={noopAdapter()}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    // renderToStaticMarkup of `null` yields empty string.
    expect(html).toBe('');
  });

  it('renders search box and three tabs with default labels when open', () => {
    const html = render(
      <MentionPopup
        open={true}
        agentId="agent-1"
        adapter={noopAdapter()}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('mention-popup');
    expect(html).toContain('mention-popup-search-input');
    expect(html).toContain('placeholder="Search skills"');
    // Three tabs are rendered in order: all | recent | collect.
    expect(html).toContain('mention-popup-tab-all');
    expect(html).toContain('mention-popup-tab-recent');
    expect(html).toContain('mention-popup-tab-collect');
    // Default tab is `all` (active).
    const allBtn = html.match(
      /<button[^>]*data-testid="mention-popup-tab-all"[^>]*>/,
    );
    expect(allBtn?.[0]).toContain('mention-popup-tab--active');
    // Default labels surface.
    expect(html).toContain('>All<');
    expect(html).toContain('>Recent<');
    expect(html).toContain('>Favorites<');
  });

  it('respects the initialTab prop and labels overrides', () => {
    const html = render(
      <MentionPopup
        open={true}
        agentId="agent-1"
        adapter={noopAdapter()}
        onSelect={() => {}}
        onClose={() => {}}
        initialTab="recent"
        labels={{
          tabAll: '全部',
          tabRecent: '最近',
          tabCollect: '收藏',
          searchPlaceholder: '搜索技能',
        }}
      />,
    );
    const recentBtn = html.match(
      /<button[^>]*data-testid="mention-popup-tab-recent"[^>]*>/,
    );
    expect(recentBtn?.[0]).toContain('mention-popup-tab--active');
    const allBtn = html.match(
      /<button[^>]*data-testid="mention-popup-tab-all"[^>]*>/,
    );
    // The 'all' tab must NOT be active when initialTab='recent'.
    expect(allBtn?.[0]).not.toContain('mention-popup-tab--active');
    expect(html).toContain('placeholder="搜索技能"');
    expect(html).toContain('>全部<');
    expect(html).toContain('>最近<');
    expect(html).toContain('>收藏<');
  });

  it('shows the default loading state on first render', () => {
    const html = render(
      <MentionPopup
        open={true}
        agentId="agent-1"
        adapter={noopAdapter()}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    // Effects have not flushed yet under renderToStaticMarkup, so the list
    // body should not contain any items — it should render the loading
    // placeholder.
    expect(html).toContain('mention-popup-item-loading');
    expect(html).toContain('Loading');
    expect(html).not.toContain('mention-popup-item-skill-1');
  });
});

describe('MentionPopupItem', () => {
  it('renders icon, name, and description for an active item', () => {
    const html = render(
      <MentionPopupItem
        skill={SAMPLE_SKILLS[0]}
        active={true}
        onClick={() => {}}
      />,
    );
    expect(html).toContain('mention-popup-item--active');
    expect(html).toContain('Generate slides');
    expect(html).toContain('Build a PPT from a prompt');
    expect(html).toContain('src="https://example.test/icon-1.png"');
    expect(html).toContain('aria-selected="true"');
  });

  it('uses an icon fallback when skill has no icon URL', () => {
    const html = render(
      <MentionPopupItem
        skill={SAMPLE_SKILLS[1]}
        active={false}
        onClick={() => {}}
      />,
    );
    // No <img> tag should be present.
    expect(html).not.toContain('<img');
    // Fallback letter (first char of name uppercased).
    expect(html).toContain('mention-popup-item-icon-fallback');
    expect(html).toContain('>S<');
    // Inactive row should not carry the active class.
    expect(html).not.toContain('mention-popup-item--active');
  });
});

describe('fetchSkillsForTab', () => {
  it('routes the `all` tab to listSkillsForAtPaged with keyword/page/pageSize', async () => {
    const paged = vi.fn(
      async (
        params: WorkbenchSkillListParams,
      ): Promise<WorkbenchSkillListResult> => {
        return { items: SAMPLE_SKILLS, total: 7, hasMore: true };
      },
    );
    const recent = vi.fn(async () => [] as WorkbenchSkillOption[]);
    const collected = vi.fn(async () => [] as WorkbenchSkillOption[]);
    const adapter: WorkbenchApiAdapter = {
      ...noopAdapter(),
      listSkillsForAtPaged: paged,
      listRecentSkills: recent,
      listCollectedSkills: collected,
    };

    const result = await fetchSkillsForTab({
      adapter,
      agentId: 'agent-1',
      tab: 'all',
      keyword: 'ppt',
      page: 2,
      pageSize: 6,
    });

    expect(paged).toHaveBeenCalledTimes(1);
    expect(paged).toHaveBeenCalledWith({
      agentId: 'agent-1',
      keyword: 'ppt',
      page: 2,
      pageSize: 6,
    });
    expect(recent).not.toHaveBeenCalled();
    expect(collected).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: SAMPLE_SKILLS,
      total: 7,
      hasMore: true,
    });
  });

  it('routes the `recent` tab to listRecentSkills (no pagination)', async () => {
    const paged = vi.fn();
    const recent = vi.fn(async () => SAMPLE_SKILLS);
    const collected = vi.fn();
    const adapter: WorkbenchApiAdapter = {
      ...noopAdapter(),
      listSkillsForAtPaged: paged,
      listRecentSkills: recent,
      listCollectedSkills: collected,
    };

    const result = await fetchSkillsForTab({
      adapter,
      agentId: 'agent-2',
      tab: 'recent',
      keyword: 'ignored',
      page: 1,
      pageSize: 6,
    });

    expect(recent).toHaveBeenCalledWith('agent-2');
    expect(paged).not.toHaveBeenCalled();
    expect(collected).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: SAMPLE_SKILLS,
      total: SAMPLE_SKILLS.length,
      hasMore: false,
    });
  });

  it('routes the `collect` tab to listCollectedSkills (no pagination)', async () => {
    const paged = vi.fn();
    const recent = vi.fn();
    const collected = vi.fn(async () => SAMPLE_SKILLS);
    const adapter: WorkbenchApiAdapter = {
      ...noopAdapter(),
      listSkillsForAtPaged: paged,
      listRecentSkills: recent,
      listCollectedSkills: collected,
    };

    const result = await fetchSkillsForTab({
      adapter,
      agentId: 'agent-3',
      tab: 'collect',
      keyword: '',
      page: 1,
      pageSize: 6,
    });

    expect(collected).toHaveBeenCalledWith('agent-3');
    expect(paged).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: SAMPLE_SKILLS,
      total: SAMPLE_SKILLS.length,
      hasMore: false,
    });
  });

  it('returns null when the adapter does not implement the required method', async () => {
    // Adapter with no skill methods at all.
    const adapter = noopAdapter();
    const all = await fetchSkillsForTab({
      adapter,
      agentId: 'a',
      tab: 'all',
      keyword: '',
      page: 1,
      pageSize: 6,
    });
    const recent = await fetchSkillsForTab({
      adapter,
      agentId: 'a',
      tab: 'recent',
      keyword: '',
      page: 1,
      pageSize: 6,
    });
    const collect = await fetchSkillsForTab({
      adapter,
      agentId: 'a',
      tab: 'collect',
      keyword: '',
      page: 1,
      pageSize: 6,
    });
    expect(all).toBeNull();
    expect(recent).toBeNull();
    expect(collect).toBeNull();
  });

  it('propagates a custom pageSize to listSkillsForAtPaged', async () => {
    const paged = vi.fn(
      async (): Promise<WorkbenchSkillListResult> => ({
        items: [],
        total: 0,
        hasMore: false,
      }),
    );
    const adapter: WorkbenchApiAdapter = {
      ...noopAdapter(),
      listSkillsForAtPaged: paged,
    };
    await fetchSkillsForTab({
      adapter,
      agentId: 'agent-1',
      tab: 'all',
      keyword: '',
      page: 1,
      pageSize: 25,
    });
    expect(paged).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 25, page: 1 }),
    );
  });
});
