import type { WorkbenchConversation } from '../../../../types';

/**
 * One row in the OpenApp sidebar history list.
 *
 * Previously this module re-exported the component from `NuwaxOpenApp`;
 * Phase B's final round moves the actual implementation here so the sidebar
 * tree owns its own UI primitives without relying on the root file.
 */
export function ConversationItem({
  item,
  active,
  onClick,
}: {
  item: WorkbenchConversation;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={
        active ? 'open-app-conversation-item active' : 'open-app-conversation-item'
      }
      onClick={onClick}
    >
      <span className="open-app-conversation-title">{item.title}</span>
      {item.status === 'active' && <span className="open-app-conversation-status" />}
    </button>
  );
}
