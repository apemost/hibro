// Keeps the side-panel provider picker in sync with extension storage.

import { useEffect, useState } from 'react';
import {
  ACTIVE_KEY,
  PROVIDERS_KEY,
  type ProviderProfile,
  readProviderConfig,
  writeActive,
} from '@/shared/providers';

/** Reads provider profiles and changes the profile used by the next request. */
export function useProviders() {
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    let alive = true;
    let loadVersion = 0;
    const refresh = async () => {
      const version = ++loadVersion;
      try {
        const c = await readProviderConfig();
        if (!alive || version !== loadVersion) return;
        setProfiles(c.profiles);
        setActiveId(c.activeId);
        setStorageError(false);
      } catch {
        if (!alive || version !== loadVersion) return;
        setStorageError(true);
      }
    };

    void refresh();
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes[PROVIDERS_KEY] || changes[ACTIVE_KEY]) void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const setActive = async (id: string) => {
    try {
      await writeActive(id);
      setActiveId(id);
    } catch {
      setStorageError(true);
    }
  };

  return { profiles, activeId, storageError, setActive };
}
