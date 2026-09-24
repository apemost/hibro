// Toolbar popup: translate the current page, pick the target language, and
// open the side panel. Setting action.default_popup stops
// chrome.action.onClicked from firing, so opening the panel lives here.

import { useEffect, useState } from 'react';
import { PanelI18nProvider, usePanelI18n } from '@/panel/i18n';
import { SettingsIcon } from '@/panel/SettingsIcon';
import { usePageTranslation } from './useTranslation';
import {
  HIBRO_OPTIONS_KEY,
  TRANSLATION_LANGUAGES,
  readTranslationTarget,
  resolveTranslationTarget,
  writeTranslationTarget,
  type TranslationLanguage,
} from '@/shared/language';

function TranslateIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h11" />
      <path d="M8 3v2c0 5-2.5 8-5 9" />
      <path d="M5 9c0 3 2.5 5.5 7 7" />
      <path d="M13 21l4-10 4 10" />
      <path d="M14.5 17h5" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function RevertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </svg>
  );
}

// Opening the side panel needs a user gesture, which this click is. The popup
// is dismissed afterwards so the panel takes focus.
async function openSidePanel(): Promise<void> {
  const window = await chrome.windows.getCurrent();
  if (window.id === undefined) return;
  await chrome.sidePanel.open({ windowId: window.id });
  globalThis.close();
}

/** The target language, kept in step with Settings while the popup is open. */
function useTranslationTarget(): [
  TranslationLanguage,
  (next: TranslationLanguage) => void,
] {
  const [target, setTarget] = useState<TranslationLanguage>('en');

  useEffect(() => {
    let alive = true;
    let version = 0;
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local' || !changes[HIBRO_OPTIONS_KEY]) return;
      version += 1;
      setTarget(resolveTranslationTarget(changes[HIBRO_OPTIONS_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    const readVersion = version;
    void readTranslationTarget().then((stored) => {
      if (alive && version === readVersion) setTarget(stored);
    });
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return [
    target,
    (next) => {
      setTarget(next);
      void writeTranslationTarget(next);
    },
  ];
}

function Popup() {
  const { messages: ui } = usePanelI18n();
  const translation = usePageTranslation();
  const [target, setTarget] = useTranslationTarget();
  const working = translation.status === 'working';
  const translated = translation.status === 'active';
  // The row keeps one shape in every state: the language stays visible and
  // only the action button changes, so the popup does not reflow as a run
  // starts and finishes.
  const action = working
    ? ui.translatingProgress(
        translation.progress.done,
        translation.progress.total,
      )
    : translated
      ? ui.showOriginal
      : ui.translatePage;

  return (
    <>
      <header className="popup-head">
        <span className="popup-title">Hibro</span>
        <button
          type="button"
          id="popupSettingsBtn"
          className="popup-icon-btn"
          data-tip={ui.settings}
          aria-label={ui.settings}
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          <SettingsIcon />
        </button>
        <button
          type="button"
          id="popupOpenPanelBtn"
          className="popup-icon-btn"
          data-tip={ui.openSidePanel}
          aria-label={ui.openSidePanel}
          onClick={() => void openSidePanel()}
        >
          <PanelIcon />
        </button>
      </header>

      <div className="popup-row">
        <label className="popup-row-label" htmlFor="popupTranslationTarget">
          {ui.translateInto}
        </label>
        <select
          id="popupTranslationTarget"
          value={target}
          disabled={working}
          onChange={(e) =>
            setTarget(e.currentTarget.value as TranslationLanguage)
          }
        >
          {TRANSLATION_LANGUAGES.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          id="popupTranslateBtn"
          className={`popup-icon-btn${translated ? ' is-on' : ''}${working ? ' is-busy' : ''}`}
          data-tip={action}
          aria-label={action}
          aria-pressed={translated}
          aria-busy={working}
          disabled={working}
          onClick={translation.toggle}
        >
          {working ? (
            <SpinnerIcon />
          ) : translated ? (
            <RevertIcon />
          ) : (
            <TranslateIcon />
          )}
        </button>
      </div>

      {translation.error && (
        <div className="popup-error" role="alert">
          <p>{translation.error}</p>
          <button type="button" onClick={translation.dismissError}>
            {ui.close}
          </button>
        </div>
      )}
    </>
  );
}

/** Toolbar popup root. */
export function PopupApp() {
  return (
    <PanelI18nProvider>
      <Popup />
    </PanelI18nProvider>
  );
}
