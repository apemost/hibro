// Provider listbox that opens upward and stays within the narrow side panel.

import { Select } from '@/components/ui/select';
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
  return (
    <Select
      className="provider-picker"
      id="providerSelect"
      aria-label={messages.llmProvider}
      value={selectedId}
      options={profiles.map((profile) => ({
        value: profile.id,
        label: profileLabel(profile),
      }))}
      placeholder={messages.noProvider}
      disabled={disabled}
      placement="top"
      onValueChange={onSelect}
    />
  );
}
