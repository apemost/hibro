import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

interface SkillActionsMenuProps {
  label: string;
  actions: {
    label: string;
    onSelect: () => void;
    destructive?: boolean;
  }[];
}

/** Provides a skill's actions with keyboard navigation and focus restoration. */
export function SkillActionsMenu({ label, actions }: SkillActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.offsetHeight;
    setOpenAbove(
      trigger.bottom + menuHeight + 4 > window.innerHeight &&
        trigger.top >= menuHeight + 4,
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const items =
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button');
    items?.[focusLast.current ? items.length - 1 : 0]?.focus({
      preventScroll: true,
    });
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function closeMenu(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className="skill-actions"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="skill-menu-trigger"
        type="button"
        ref={triggerRef}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          focusLast.current = false;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            focusLast.current = event.key === 'ArrowUp';
            setOpen(true);
          }
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>
      {open && (
        <div
          className="skill-menu"
          data-placement={openAbove ? 'top' : 'bottom'}
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              if (event.key === 'Escape') event.preventDefault();
              closeMenu();
              return;
            }
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button',
              ),
            ];
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let next: number;
            switch (event.key) {
              case 'ArrowDown':
                next = (index + 1) % items.length;
                break;
              case 'ArrowUp':
                next = (index - 1 + items.length) % items.length;
                break;
              case 'Home':
                next = 0;
                break;
              case 'End':
                next = items.length - 1;
                break;
              default:
                return;
            }
            event.preventDefault();
            items[next]?.focus();
          }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={action.destructive ? 'destructive' : undefined}
              onClick={() => {
                closeMenu();
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
