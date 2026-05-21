/**
 * useMentionSearch
 *
 * State machine for the MentionPopup's three tabs.
 *
 * Behaviour, distilled from nuwax `MentionPopup/index.tsx`:
 * - 'all' tab calls `adapter.listSkillsForAtPaged` with `{ keyword, page,
 *   pageSize }` and supports incremental "load more" pagination + keyword
 *   search (server-side filter).
 * - 'recent' and 'collect' tabs call `adapter.listRecentSkills` /
 *   `listCollectedSkills` for the *full* list; the keyword filter for those
 *   tabs is applied client-side because nuwax's endpoints do not support
 *   search.
 *
 * Keyword changes trigger a debounced reload for the active tab.
 *
 * This hook intentionally keeps no React state for the keyword itself — the
 * caller owns the search box. The hook is given an `effectiveKeyword` and
 * the active tab, and it returns `{ items, loading, hasMore, loadMore, total }`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  WorkbenchApiAdapter,
  WorkbenchSkillOption,
} from '../../types';
import type { MentionPopupTab } from './types';

export interface UseMentionSearchOptions {
  adapter: WorkbenchApiAdapter;
  agentId: string;
  tab: MentionPopupTab;
  keyword: string;
  /** Page size for the paginated 'all' endpoint. Mirrors nuwax PAGE_SIZE=6. */
  pageSize?: number;
  /** Debounce window (ms) for keyword-triggered reloads. */
  debounceMs?: number;
  /** Allow tests to disable the debounce timer. Defaults to true. */
  enableDebounce?: boolean;
  /** When `false` the hook does not fetch (e.g. when popup is closed). */
  enabled?: boolean;
}

export interface MentionSearchState {
  items: WorkbenchSkillOption[];
  /** True while a fetch is in-flight (initial load or load-more). */
  loading: boolean;
  /** True when the 'all' tab has more pages on the server. */
  hasMore: boolean;
  /** Total count reported by the server (or local list size for full lists). */
  total: number;
  /** True if any fetch has resolved for the current (tab,keyword) tuple. */
  initialized: boolean;
  /** Trigger a fetch of the next page on the 'all' tab. No-op elsewhere. */
  loadMore: () => void;
  /** Force-refresh the current tab from page 1. */
  reload: () => void;
}

const DEFAULT_PAGE_SIZE = 6;
const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Pure helper that dispatches to the correct adapter method for the given
 * tab. Exposed for unit testing — the hook just wires this into a
 * `useEffect` and React state.
 *
 * Returns `null` when the adapter does not implement the method for `tab`.
 */
export interface FetchSkillsArgs {
  adapter: WorkbenchApiAdapter;
  agentId: string;
  tab: MentionPopupTab;
  keyword: string;
  page: number;
  pageSize: number;
}

export interface FetchSkillsResult {
  items: WorkbenchSkillOption[];
  total: number;
  hasMore: boolean;
}

export async function fetchSkillsForTab(
  args: FetchSkillsArgs,
): Promise<FetchSkillsResult | null> {
  const { adapter, agentId, tab, keyword, page, pageSize } = args;
  if (tab === 'all') {
    if (typeof adapter.listSkillsForAtPaged !== 'function') return null;
    const result = await adapter.listSkillsForAtPaged({
      agentId,
      keyword,
      page,
      pageSize,
    });
    return {
      items: result.items,
      total: result.total,
      hasMore: result.hasMore,
    };
  }
  if (tab === 'recent') {
    if (typeof adapter.listRecentSkills !== 'function') return null;
    const items = await adapter.listRecentSkills(agentId);
    return { items, total: items.length, hasMore: false };
  }
  // 'collect'
  if (typeof adapter.listCollectedSkills !== 'function') return null;
  const items = await adapter.listCollectedSkills(agentId);
  return { items, total: items.length, hasMore: false };
}

interface InternalState {
  items: WorkbenchSkillOption[];
  page: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  initialized: boolean;
}

function emptyState(): InternalState {
  return {
    items: [],
    page: 0,
    total: 0,
    hasMore: true,
    // Start in the loading state so the initial render shows a placeholder
    // (rather than a confusing "no results" message) while the first fetch
    // is in-flight.
    loading: true,
    initialized: false,
  };
}

function filterLocal(
  items: WorkbenchSkillOption[],
  keyword: string,
): WorkbenchSkillOption[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return items;
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(kw) ||
      (item.description?.toLowerCase().includes(kw) ?? false),
  );
}

export function useMentionSearch(
  opts: UseMentionSearchOptions,
): MentionSearchState {
  const {
    adapter,
    agentId,
    tab,
    keyword,
    pageSize = DEFAULT_PAGE_SIZE,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    enableDebounce = true,
    enabled = true,
  } = opts;

  const [state, setState] = useState<InternalState>(() => emptyState());
  /** Monotonic token to drop responses from stale requests. */
  const reqIdRef = useRef(0);
  /** Track the latest request's tab/keyword so we know when to reset. */
  const lastKeyRef = useRef<string>('');

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      const reqId = ++reqIdRef.current;
      setState((prev) => ({ ...prev, loading: true }));

      try {
        const result = await fetchSkillsForTab({
          adapter,
          agentId,
          tab,
          keyword,
          page,
          pageSize,
        });
        if (reqIdRef.current !== reqId) return;
        if (!result) {
          // Adapter doesn't implement this tab's method — surface an empty
          // list rather than spinning forever.
          setState({
            items: [],
            page: 1,
            total: 0,
            hasMore: false,
            loading: false,
            initialized: true,
          });
          return;
        }
        setState((prev) => ({
          items: append ? [...prev.items, ...result.items] : result.items,
          page,
          total: result.total,
          hasMore: result.hasMore,
          loading: false,
          initialized: true,
        }));
      } catch (error) {
        if (reqIdRef.current !== reqId) return;
        // Log but never throw — mention popup should fall back to an empty
        // list rather than crashing the chat input.
        // eslint-disable-next-line no-console
        console.error('[MentionPopup] failed to load tab', tab, error);
        setState((prev) => ({
          ...prev,
          loading: false,
          initialized: true,
          hasMore: false,
        }));
      }
    },
    [adapter, agentId, tab, keyword, pageSize],
  );

  /** Reset + load page 1 when tab or keyword changes (or hook (re)mounts). */
  useEffect(() => {
    if (!enabled) return;
    const key = `${tab}::${keyword}`;
    lastKeyRef.current = key;
    // Reset to a clean state before kicking off the fetch.
    setState(emptyState());
    if (!enableDebounce || debounceMs <= 0) {
      void fetchPage(1, false);
      return;
    }
    const timer = setTimeout(() => {
      if (lastKeyRef.current !== key) return;
      void fetchPage(1, false);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [tab, keyword, enabled, debounceMs, enableDebounce, fetchPage]);

  const loadMore = useCallback(() => {
    if (tab !== 'all') return;
    if (!state.hasMore || state.loading || !state.initialized) return;
    void fetchPage(state.page + 1, true);
  }, [tab, state.hasMore, state.loading, state.initialized, state.page, fetchPage]);

  const reload = useCallback(() => {
    void fetchPage(1, false);
  }, [fetchPage]);

  // For 'recent' / 'collect', apply the keyword filter on the client. The 'all'
  // tab already filters server-side so we expose its result as-is.
  const visibleItems = useMemo(() => {
    if (tab === 'all') return state.items;
    return filterLocal(state.items, keyword);
  }, [tab, state.items, keyword]);

  return {
    items: visibleItems,
    loading: state.loading,
    hasMore: tab === 'all' ? state.hasMore : false,
    total: state.total,
    initialized: state.initialized,
    loadMore,
    reload,
  };
}
