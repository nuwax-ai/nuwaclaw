/**
 * MentionPopupItem
 *
 * Single row in the @-mention popup list. Mirrors nuwax `.mention-item` —
 * left icon, name + optional description — but without antd dependencies
 * and uses workbench-flavoured `.mention-popup-*` classes for styling.
 */
import type { MouseEventHandler } from 'react';
import type { WorkbenchSkillOption } from '../../types';

export interface MentionPopupItemProps {
  skill: WorkbenchSkillOption;
  active: boolean;
  onClick: (skill: WorkbenchSkillOption) => void;
  /**
   * Called on mouse-move (not mouse-enter) so keyboard navigation does not
   * fight hover state when the cursor sits over a non-active row.
   */
  onHover?: (skill: WorkbenchSkillOption) => void;
  /** Whether to show the subscription price tag for paid skills. */
  enableSubscription?: boolean;
  /** Label for "Paid" tag. */
  paidTag?: string;
  /** Label for "Subscribed" tag. */
  subscribedTag?: string;
}

export function MentionPopupItem({
  skill,
  active,
  onClick,
  onHover,
  enableSubscription = false,
  paidTag = 'Paid',
  subscribedTag = 'Subscribed',
}: MentionPopupItemProps): JSX.Element {
  const className =
    'mention-popup-item' + (active ? ' mention-popup-item--active' : '');

  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(skill);
  };

  const handleMouseMove: MouseEventHandler<HTMLDivElement> = () => {
    onHover?.(skill);
  };

  const showPaymentTag = enableSubscription && skill.paymentRequired === true;
  const isSubscribed = skill.subscribed === true;

  return (
    <div
      className={className}
      data-testid={`mention-popup-item-${skill.id}`}
      role="option"
      aria-selected={active}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
    >
      <span className="mention-popup-item-icon" aria-hidden>
        {skill.icon ? (
          <img src={skill.icon} alt="" />
        ) : (
          <span className="mention-popup-item-icon-fallback">
            {skill.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <div className="mention-popup-item-content">
        <div className="mention-popup-item-name">{skill.name}</div>
        {skill.description ? (
          <div className="mention-popup-item-desc">{skill.description}</div>
        ) : null}
      </div>
      {showPaymentTag ? (
        <span
          className={
            'mention-popup-item-tag' +
            (isSubscribed
              ? ' mention-popup-item-tag--subscribed'
              : ' mention-popup-item-tag--paid')
          }
          data-testid={`mention-popup-item-tag-${skill.id}`}
        >
          {isSubscribed ? subscribedTag : paidTag}
        </span>
      ) : null}
    </div>
  );
}
