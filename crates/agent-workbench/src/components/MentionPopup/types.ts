/**
 * MentionPopup public types.
 *
 * Kept separate from `index.tsx` so the type re-exports in
 * `src/index.ts` can be imported without bringing JSX into scope.
 */
import type {
  WorkbenchApiAdapter,
  WorkbenchSkillOption,
} from '../../types';

/**
 * Three tabs in the @-mention popup:
 * - `all`     → paginated server search (`listSkillsForAtPaged`)
 * - `recent`  → recently-used skills (`listRecentSkills`, full list)
 * - `collect` → collected/favourited skills (`listCollectedSkills`, full list)
 *
 * Note: this maps to nuwax's `'all' | 'recent' | 'favorite'` — the workbench
 * adapter contract uses `'collect'` instead of `'favorite'` (see
 * `WorkbenchSkillListTab` in `src/types.ts`).
 */
export type MentionPopupTab = 'all' | 'recent' | 'collect';

export interface MentionPopupLabels {
  /** Tab label for the "all skills" tab. Default: "All". */
  tabAll?: string;
  /** Tab label for the "recently used" tab. Default: "Recent". */
  tabRecent?: string;
  /** Tab label for the "collected" tab. Default: "Favorites". */
  tabCollect?: string;
  /** Placeholder for the in-popup search input. Default: "Search skills". */
  searchPlaceholder?: string;
  /** Shown when the active tab returns no items. Default: "No skills". */
  empty?: string;
  /** Shown while the first page is loading. Default: "Loading…". */
  loading?: string;
  /** Shown above the load-more sentinel while paginating. Default: "Loading more…". */
  loadingMore?: string;
  /** Tag text for a paid skill that the user has not subscribed to. Default: "Paid". */
  paidTag?: string;
  /** Tag text for a paid skill that the user has already subscribed to. Default: "Subscribed". */
  subscribedTag?: string;
}

export interface MentionPopupProps {
  /** When false the popup renders `null`. */
  open: boolean;
  /** Used by the adapter to scope skill listings. */
  agentId: string;
  /** Adapter from the workbench config. Must provide at least one of
   *  `listSkillsForAtPaged` / `listRecentSkills` / `listCollectedSkills`. */
  adapter: WorkbenchApiAdapter;
  /** Called when the user picks a skill (click or Enter). */
  onSelect: (skill: WorkbenchSkillOption) => void;
  /** Called when the user dismisses the popup (Esc or outside click). */
  onClose: () => void;
  /** Optional initial tab. Defaults to `'all'`. */
  initialTab?: MentionPopupTab;
  /** Localised strings. */
  labels?: MentionPopupLabels;
  /**
   * Page size for the `'all'` tab. Mirrors nuwax `PAGE_SIZE = 6`.
   * Override to fetch more rows per page.
   */
  pageSize?: number;
  /**
   * Debounce window (ms) before keyword changes trigger a reload. Set to 0
   * to disable. Default 300ms.
   */
  debounceMs?: number;
  /**
   * When true (tenant-level config), paid skills display a price /
   * subscription tag. Mirrors nuwax `enableSubscription`.
   */
  enableSubscription?: boolean;
}
