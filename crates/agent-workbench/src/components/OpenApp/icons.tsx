/**
 * Inline SVG icon set + small wrapper components used across the OpenApp UI.
 *
 * Extracted from `NuwaxOpenApp.tsx` so that `ChatInputHome` (and other
 * subcomponents that previously reached back into `NuwaxOpenApp` for these
 * glyphs) can import them without forming a circular module dependency.
 *
 * The SVG path data and the className conventions match the original inline
 * definitions exactly — there are no visual changes from this move.
 */

import type { WorkbenchAgentDetail } from '../../types';
import { agentInitial } from './utils';

export type IconName =
  | 'sidebar'
  | 'plus'
  | 'history'
  | 'folder'
  | 'terminal'
  | 'page'
  | 'close'
  | 'back'
  | 'forward'
  | 'reload'
  | 'link'
  | 'send'
  | 'stop'
  | 'attachment'
  | 'tools'
  | 'spark';

const ICON_PATHS = {
  sidebar: 'M4 5.5h16M4 12h16M4 18.5h16M8 5.5v13',
  plus: 'M12 5v14M5 12h14',
  history: 'M4 12a8 8 0 1 0 2.35-5.65M4 5v5h5M12 8v5l3 2',
  folder: 'M3 6h7l2 2h9v10H3z',
  terminal: 'M5 7l5 5-5 5M12 17h7',
  page: 'M7 4h7l4 4v12H7zM14 4v5h5',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 6l-6 6 6 6',
  forward: 'M9 6l6 6-6 6',
  reload: 'M19 12a7 7 0 1 1-2.05-4.95M19 5v5h-5',
  link: 'M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10.5 5.43M14 11a5 5 0 0 0-7.07 0l-1.41 1.41a5 5 0 0 0 7.07 7.07l.91-.91',
  send: 'M5 12h13M13 6l6 6-6 6',
  stop: 'M8 8h8v8H8z',
  attachment:
    'M21.44 11.05 12.2 20.3a6 6 0 0 1-8.49-8.49l9.19-9.2a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-3-3z',
  spark:
    'M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
} satisfies Record<IconName, string>;

export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="open-app-svg-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function IconButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: IconName;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className="open-app-icon-button" type="button" title={title} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function AgentAvatar({ agent }: { agent: WorkbenchAgentDetail | null }): JSX.Element {
  if (agent?.icon) {
    return (
      <img
        className="open-app-agent-avatar"
        src={agent.icon}
        alt=""
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
    );
  }
  return (
    <div className="open-app-agent-avatar open-app-agent-avatar-fallback">
      {agentInitial(agent?.name ?? 'Agent')}
    </div>
  );
}
