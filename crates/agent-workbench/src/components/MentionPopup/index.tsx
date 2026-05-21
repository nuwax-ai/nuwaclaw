/**
 * MentionPopup — @-mention skill picker for the agent workbench.
 * Three tabs: all (server search), recent, collect. Keyboard navigation
 * (ArrowUp/Down/Enter/Esc). Load more on scroll for the `all` tab.
 * Does not manage caret/anchor — caller controls position, portable
 * across Electron, storybook, and standalone demos.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import type { WorkbenchSkillOption } from '../../types';
import { MentionPopupItem } from './Item';
import { useMentionSearch } from './useMentionSearch';
import type {
  MentionPopupLabels,
  MentionPopupProps,
  MentionPopupTab,
} from './types';

export type { MentionPopupProps, MentionPopupTab } from './types';

const DEFAULT_LABELS: Required<MentionPopupLabels> = {
  tabAll: 'All',
  tabRecent: 'Recent',
  tabCollect: 'Favorites',
  searchPlaceholder: 'Search skills',
  empty: 'No skills',
  loading: 'Loading…',
  loadingMore: 'Loading more…',
};

const TAB_ORDER: MentionPopupTab[] = ['all', 'recent', 'collect'];

export function MentionPopup(props: MentionPopupProps): JSX.Element | null {
  const {
    open,
    agentId,
    adapter,
    onSelect,
    onClose,
    initialTab = 'all',
    labels: labelsProp,
    pageSize,
    debounceMs,
  } = props;

  const labels = { ...DEFAULT_LABELS, ...(labelsProp ?? {}) };

  const [tab, setTab] = useState<MentionPopupTab>(initialTab);
  const [keyword, setKeyword] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset internal state every time the popup is re-opened so the next mount
  // does not retain stale tab/keyword/active-row state.
  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setKeyword('');
      setActiveIndex(0);
    }
  }, [open, initialTab]);

  const search = useMentionSearch({
    adapter,
    agentId,
    tab,
    keyword,
    pageSize,
    debounceMs,
    enabled: open,
  });

  const items = search.items;

  // Keep activeIndex in range as the list shrinks/grows.
  useEffect(() => {
    if (items.length === 0) {
      setActiveIndex(0);
      return;
    }
    if (activeIndex >= items.length) {
      setActiveIndex(items.length - 1);
    }
  }, [items.length, activeIndex]);

  // Reset active row whenever tab or keyword changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [tab, keyword]);

  // ---------- Outside click ----------
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function handleDocMouseDown(event: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      onClose();
    }
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, [open, onClose]);

  // ---------- Load-more via IntersectionObserver ----------
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    if (tab !== 'all') return;
    if (typeof IntersectionObserver === 'undefined') return;
    const sentinel = sentinelRef.current;
    const root = listRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            search.loadMore();
            break;
          }
        }
      },
      {
        root,
        rootMargin: '0px',
        threshold: 0.01,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, tab, search]);

  // ---------- Keyboard handling ----------
  const onPick = useCallback(
    (skill: WorkbenchSkillOption) => {
      onSelect(skill);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          if (items.length === 0) return;
          setActiveIndex((idx) => {
            const next = idx + 1;
            if (next < items.length) return next;
            // At the end of the list — request another page if there is one;
            // otherwise wrap to the top.
            if (search.hasMore) {
              search.loadMore();
              return idx;
            }
            return 0;
          });
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          if (items.length === 0) return;
          setActiveIndex((idx) => (idx <= 0 ? items.length - 1 : idx - 1));
          break;
        }
        case 'Enter': {
          event.preventDefault();
          const picked = items[activeIndex];
          if (picked) onPick(picked);
          break;
        }
        case 'Escape': {
          event.preventDefault();
          onClose();
          break;
        }
        case 'Tab': {
          // Tab cycles through the three tabs; Shift+Tab cycles backward.
          event.preventDefault();
          const dir = event.shiftKey ? -1 : 1;
          const i = TAB_ORDER.indexOf(tab);
          const next =
            TAB_ORDER[(i + dir + TAB_ORDER.length) % TAB_ORDER.length];
          setTab(next);
          break;
        }
      }
    },
    [items, activeIndex, onPick, onClose, search, tab],
  );

  const onSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setKeyword(event.target.value);
  }, []);

  const showEmpty = useMemo(
    () => search.initialized && !search.loading && items.length === 0,
    [search.initialized, search.loading, items.length],
  );

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      className="mention-popup"
      role="listbox"
      data-testid="mention-popup"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      onMouseDown={(event) => {
        // Prevent the host editor from losing focus when the user clicks the
        // popup chrome (tabs, search input border, gaps).
        if (
          event.target instanceof HTMLElement &&
          event.target.closest('[data-mention-search-input]')
        ) {
          return;
        }
        event.preventDefault();
      }}
    >
      <div className="mention-popup-search" data-mention-search-input>
        <input
          type="text"
          className="mention-popup-search-input"
          placeholder={labels.searchPlaceholder}
          value={keyword}
          onChange={onSearchChange}
          onKeyDown={handleKeyDown}
          aria-label={labels.searchPlaceholder}
          data-testid="mention-popup-search-input"
        />
      </div>
      <div className="mention-popup-tabs" role="tablist">
        {TAB_ORDER.map((key) => {
          const isActive = tab === key;
          const tabLabel =
            key === 'all' ? labels.tabAll :
            key === 'recent' ? labels.tabRecent :
            labels.tabCollect;
          const className =
            'mention-popup-tab' +
            (isActive ? ' mention-popup-tab--active' : '');
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={className}
              data-testid={`mention-popup-tab-${key}`}
              onClick={() => setTab(key)}
            >
              {tabLabel}
            </button>
          );
        })}
      </div>
      <div
        ref={listRef}
        className="mention-popup-list"
        data-testid="mention-popup-list"
      >
        {search.loading && items.length === 0 ? (
          <div className="mention-popup-item-loading">{labels.loading}</div>
        ) : showEmpty ? (
          <div className="mention-popup-item-empty">{labels.empty}</div>
        ) : (
          items.map((skill, idx) => (
            <MentionPopupItem
              key={skill.id}
              skill={skill}
              active={idx === activeIndex}
              onClick={onPick}
              onHover={() => setActiveIndex(idx)}
            />
          ))
        )}
        {tab === 'all' && search.hasMore && items.length > 0 ? (
          <div
            ref={sentinelRef}
            className="mention-popup-item-loading"
            data-testid="mention-popup-load-more"
          >
            {search.loading ? labels.loadingMore : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}
