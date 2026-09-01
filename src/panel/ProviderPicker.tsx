// Provider listbox that opens upward and stays within the narrow side panel.

import { useEffect, useRef, useState } from 'react';
import type { ProviderProfile } from '@/shared/providers';
import { usePanelI18n } from './i18n';

/** Formats a provider label for the side-panel picker. */
export const profileLabel = (p: ProviderProfile): string =>
  p.model ? `${p.name} / ${p.model}` : p.name;

interface ProviderPickerProps {
  profiles: ProviderProfile[];
  selectedId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}

/** Renders the active provider picker beside the composer. */
export function ProviderPicker({
  profiles,
  selectedId,
  disabled,
  onSelect,
}: ProviderPickerProps) {
  const { messages } = usePanelI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = profiles.find((p) => p.id === selectedId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="provider-picker" ref={rootRef}>
      <button
        type="button"
        id="providerSelect"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={messages.llmProvider}
        title={selected ? profileLabel(selected) : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="provider-picker-label">
          {selected ? profileLabel(selected) : messages.noProvider}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && profiles.length > 0 && (
        <div
          className="provider-menu"
          role="listbox"
          aria-label={messages.llmProvider}
        >
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === selectedId}
              onClick={() => {
                onSelect(p.id);
                setOpen(false);
              }}
            >
              {profileLabel(p)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
