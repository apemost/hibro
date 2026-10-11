import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import './controls.css';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  id?: string;
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  placement?: 'bottom' | 'top' | 'flow';
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** A controlled Hibro listbox with keyboard navigation and bounded menus. */
export function Select({
  id,
  value,
  options,
  onValueChange,
  disabled = false,
  placeholder = '',
  className = '',
  placement = 'bottom',
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const menuId = `${triggerId}-listbox`;
  const selected = options.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const expanded = open && !disabled && options.length > 0;
  const activeIndex = Math.min(active, options.length - 1);

  function show(index = selected < 0 ? 0 : selected) {
    if (disabled || !options.length) return;
    search.current = { text: '', time: 0 };
    setActive(index);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    setOpen(false);
    trigger.current?.focus();
    onValueChange(option.value);
  }

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded || placement === 'flow') return;
    const update = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up =
        placement === 'top'
          ? above >= 120 || above >= below
          : below < 120 && above > below;
      const width = Math.min(
        Math.max(rect.width, placement === 'top' ? 240 : 180),
        window.innerWidth - 16,
      );
      setPosition({
        position: 'fixed',
        width,
        left: Math.max(
          8,
          Math.min(
            placement === 'top' ? rect.right - width : rect.left,
            window.innerWidth - width - 8,
          ),
        ),
        top: up ? undefined : rect.bottom + 4,
        bottom: up ? window.innerHeight - rect.top + 4 : undefined,
        maxHeight: Math.max(40, Math.min(260, up ? above : below)),
      });
    };
    const onScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) update();
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [expanded, placement]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const list = menu.current;
    const option = list?.children[activeIndex] as HTMLElement | undefined;
    if (!list || !option) return;
    // Scroll only the list, never the popup or Settings document.
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (
      option.offsetTop + option.offsetHeight >
      list.scrollTop + list.clientHeight
    ) {
      list.scrollTop =
        option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [expanded, activeIndex, position]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!expanded)
        show(
          event.key === 'End'
            ? options.length - 1
            : event.key === 'Home'
              ? 0
              : undefined,
        );
      else
        setActive(
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : Math.max(
                  0,
                  Math.min(
                    options.length - 1,
                    activeIndex + (event.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
        );
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (expanded) choose(activeIndex);
      else show();
      return;
    }
    if (
      event.key.length !== 1 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    const now = Date.now();
    const text =
      (now - search.current.time < 700 ? search.current.text : '') +
      event.key.toLocaleLowerCase();
    search.current = { text, time: now };
    const query = [...text].every((char) => char === text[0]) ? text[0] : text;
    const start = expanded ? activeIndex : selected;
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (Math.max(-1, start) + offset) % options.length;
      if (options[index].label.toLocaleLowerCase().startsWith(query)) {
        setActive(index);
        setOpen(true);
        break;
      }
    }
  }

  return (
    <div
      className={`hibro-select ${className}`}
      data-placement={placement}
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        id={triggerId}
        className="hibro-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? menuId : undefined}
        aria-activedescendant={
          expanded ? `${menuId}-${activeIndex}` : undefined
        }
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        data-value={value}
        disabled={disabled || !options.length}
        title={selected >= 0 ? options[selected].label : placeholder}
        onKeyDown={onKeyDown}
        onClick={() => (expanded ? setOpen(false) : show())}
      >
        <span className="hibro-select-label">
          {selected >= 0 ? options[selected].label : placeholder}
        </span>
        <span className="hibro-select-chevron" aria-hidden="true" />
      </button>
      {expanded && (
        <div
          ref={menu}
          id={menuId}
          role="listbox"
          className="hibro-select-menu"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : triggerId}
          style={placement === 'flow' ? undefined : position}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${menuId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              data-value={option.value}
              data-active={index === activeIndex}
              className="hibro-select-option"
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span className="hibro-select-check" aria-hidden="true">
                {option.value === value ? '✓' : ''}
              </span>
              <span>{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
