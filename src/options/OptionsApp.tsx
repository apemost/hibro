// Settings for general preferences, provider profiles, and site skills.

import { getBuiltinSkillMeta, type StoredUserSkill } from '@/skills';
import {
  ACTIVE_KEY,
  PRIVACY_CONSENT_KEY,
  PROVIDERS_KEY,
  isSecureProviderBaseUrl,
  type ProviderProfile,
  type ProviderType,
  readProviderConfig,
  readPrivacyConsent,
  writeActive,
  writePrivacyConsent,
  writeProfiles,
} from '@/shared/providers';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_OPTIONS_LANGUAGE,
  OPTIONS_KEY,
  OPTIONS_LANGUAGE_LABELS,
  OPTIONS_MESSAGES,
  readOptionsLanguage,
  readOptionsTranslationTarget,
  resolveOptionsLanguage,
  resolveOptionsTranslationTarget,
  writeOptionsLanguage,
  writeOptionsTranslationTarget,
  type OptionsLanguage,
} from './i18n';
import {
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
} from '@/shared/language';

type SkillState = Record<string, { enabled?: boolean } | undefined>;
type OptionsTab = 'general' | 'config' | 'skills';

const USER_KEY = 'hibroUserSkills';
const STATE_KEY = 'hibroSkillState';

const PROVIDER_TYPES: { value: ProviderType; label: string }[] = [
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

const FLASH_MS = 2000;
type ProviderStatus = 'saved' | 'added' | 'deleted';
type SkillStatus = 'created' | 'saved' | 'deleted';

/** Renders the Hibro Settings page. */
export function OptionsApp() {
  const [language, setLanguage] = useState<OptionsLanguage>(
    DEFAULT_OPTIONS_LANGUAGE,
  );
  const messages = OPTIONS_MESSAGES[language];

  // LLM providers
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(
    null,
  );
  const [providerStorageError, setProviderStorageError] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);

  // Provider editor form state.
  const [pEditId, setPEditId] = useState('');
  const [pEditName, setPEditName] = useState('');
  const [pEditType, setPEditType] = useState<ProviderType>('openai-compatible');
  const [pEditBaseUrl, setPEditBaseUrl] = useState('');
  const [pEditBaseUrlError, setPEditBaseUrlError] = useState(false);
  const [pEditApiKey, setPEditApiKey] = useState('');
  const [pEditModel, setPEditModel] = useState('');
  const providerDialogRef = useRef<HTMLDialogElement>(null);

  // Tabs and skills
  const [tab, setTab] = useState<OptionsTab>('config');
  const [builtins] = useState(() => getBuiltinSkillMeta());
  const [users, setUsers] = useState<StoredUserSkill[]>([]);
  const [skillState, setSkillState] = useState<SkillState>({});
  const [skillStatus, setSkillStatus] = useState<SkillStatus | null>(null);

  // Skill editor form state.
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editMatch, setEditMatch] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);

  // Defaults to the interface language until the stored preference loads.
  const [translationTarget, setTranslationTarget] =
    useState<TranslationLanguage>(DEFAULT_OPTIONS_LANGUAGE);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    let providerLoad = 0;
    let languageStorageVersion = 0;
    let consentStorageVersion = 0;

    const refreshProviders = async () => {
      const load = ++providerLoad;
      try {
        const c = await readProviderConfig();
        if (!alive || load !== providerLoad) return;
        setProviders(c.profiles);
        setActiveId(c.activeId);
        setProviderStorageError(false);
      } catch {
        if (!alive || load !== providerLoad) return;
        setProviderStorageError(true);
        setProviderStatus(null);
      }
    };

    // Apply provider changes made by another open extension page.
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes[PROVIDERS_KEY] || changes[ACTIVE_KEY])
        void refreshProviders();
      if (changes[PRIVACY_CONSENT_KEY]) {
        consentStorageVersion += 1;
        setPrivacyConsent(changes[PRIVACY_CONSENT_KEY].newValue === true);
      }
      if (changes[OPTIONS_KEY]) {
        languageStorageVersion += 1;
        setLanguage(resolveOptionsLanguage(changes[OPTIONS_KEY].newValue));
        setTranslationTarget(
          resolveOptionsTranslationTarget(changes[OPTIONS_KEY].newValue),
        );
      }
    };
    chrome.storage.onChanged.addListener(onChanged);

    void refreshProviders();
    const consentReadVersion = consentStorageVersion;
    void readPrivacyConsent().then((accepted) => {
      if (alive && consentStorageVersion === consentReadVersion)
        setPrivacyConsent(accepted);
    });
    const languageReadVersion = languageStorageVersion;
    void readOptionsLanguage().then((stored) => {
      if (alive && languageStorageVersion === languageReadVersion)
        setLanguage(stored);
    });
    void readOptionsTranslationTarget().then((stored) => {
      if (alive && languageStorageVersion === languageReadVersion)
        setTranslationTarget(stored);
    });
    void (async () => {
      const us = (await chrome.storage.local.get(USER_KEY))[USER_KEY] as
        | StoredUserSkill[]
        | undefined;
      if (!alive) return;
      setUsers(us ?? []);
      const st = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] as
        | SkillState
        | undefined;
      if (!alive) return;
      setSkillState(st ?? {});
    })();

    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = messages.title;
  }, [language, messages.title]);

  function flash<T>(setter: (value: T | null) => void, value: T): void {
    setter(value);
    setTimeout(() => setter(null), FLASH_MS);
  }

  function changeLanguage(next: OptionsLanguage): void {
    setLanguage(next);
    void writeOptionsLanguage(next);
  }

  function changeTranslationTarget(next: TranslationLanguage): void {
    setTranslationTarget(next);
    void writeOptionsTranslationTarget(next);
  }

  function activateTab(name: OptionsTab): void {
    setTab(name);
  }

  // Provider handlers

  function openProviderEditor(p?: ProviderProfile): void {
    setPEditId(p?.id ?? '');
    setPEditName(p?.name ?? '');
    setPEditType(p?.provider ?? 'openai-compatible');
    setPEditBaseUrl(p?.baseUrl ?? '');
    setPEditBaseUrlError(false);
    setPEditApiKey('');
    setPEditModel(p?.model ?? '');
    providerDialogRef.current?.showModal();
  }

  async function onProviderSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const baseUrl = pEditBaseUrl.trim() || undefined;
    if (!isSecureProviderBaseUrl(baseUrl)) {
      setPEditBaseUrlError(true);
      return;
    }
    const id = pEditId || crypto.randomUUID();
    const existing = providers.find((provider) => provider.id === id);
    const profile: ProviderProfile = {
      id,
      name: pEditName.trim() || pEditType,
      provider: pEditType,
      baseUrl,
      apiKey: pEditApiKey.trim() || existing?.apiKey || '',
      model: pEditModel.trim(),
    };
    const existed = Boolean(existing);
    const list = existed
      ? providers.map((x) => (x.id === id ? profile : x))
      : [...providers, profile];
    try {
      await writeProfiles(list);
      // The first profile (or a replacement of the active one) becomes active.
      if (!activeId || !list.some((x) => x.id === activeId)) {
        await writeActive(id);
        setActiveId(id);
      }
      setProviders(list);
      setProviderStorageError(false);
    } catch {
      setProviderStorageError(true);
      setProviderStatus(null);
      return;
    }
    providerDialogRef.current?.close();
    flash(setProviderStatus, existed ? 'saved' : 'added');
  }

  async function deleteProvider(id: string): Promise<void> {
    const list = providers.filter((x) => x.id !== id);
    try {
      await writeProfiles(list);
      if (activeId === id) {
        const next = list[0]?.id ?? null;
        if (next) await writeActive(next);
        else await chrome.storage.local.remove(ACTIVE_KEY);
        setActiveId(next);
      }
      setProviders(list);
      setProviderStorageError(false);
    } catch {
      setProviderStorageError(true);
      setProviderStatus(null);
      return;
    }
    flash(setProviderStatus, 'deleted');
  }

  async function activateProvider(id: string): Promise<void> {
    try {
      await writeActive(id);
      setActiveId(id);
    } catch {
      setProviderStorageError(true);
      setProviderStatus(null);
    }
  }

  // Skill handlers

  function openEditor(skill?: StoredUserSkill): void {
    setEditId(skill?.id ?? '');
    setEditName(skill?.name ?? '');
    setEditDesc(skill?.description ?? '');
    setEditMatch(skill?.match.join('\n') ?? '');
    setEditInstructions(skill?.instructions ?? '');
    setEditEnabled(skill?.enabled ?? true);
    dialogRef.current?.showModal();
    // Do not steal focus when the user already reached another field.
    requestAnimationFrame(() => {
      const dlg = dialogRef.current;
      if (dlg && !dlg.contains(document.activeElement))
        nameRef.current?.focus();
    });
  }

  async function onSkillSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const match = editMatch
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    const id = editId || `user:${crypto.randomUUID()}`;
    const skill: StoredUserSkill = {
      id,
      name: editName.trim(),
      description: editDesc.trim(),
      match,
      instructions: editInstructions.trim() || undefined,
      enabled: editEnabled,
    };
    const list =
      (await ((
        await chrome.storage.local.get(USER_KEY)
      )[USER_KEY] as StoredUserSkill[] | undefined)) ?? [];
    const idx = list.findIndex((x) => x.id === id);
    const created = idx < 0;
    if (idx >= 0) list[idx] = skill;
    else list.push(skill);
    await chrome.storage.local.set({ [USER_KEY]: list });
    setUsers(list);
    dialogRef.current?.close();
    flash(setSkillStatus, created ? 'created' : 'saved');
  }

  async function toggleUser(id: string, enabled: boolean): Promise<void> {
    const list = users.map((u) => (u.id === id ? { ...u, enabled } : u));
    setUsers(list);
    await chrome.storage.local.set({ [USER_KEY]: list });
  }

  async function deleteUser(id: string): Promise<void> {
    const list = users.filter((u) => u.id !== id);
    setUsers(list);
    await chrome.storage.local.set({ [USER_KEY]: list });
    flash(setSkillStatus, 'deleted');
  }

  async function toggleBuiltin(id: string, enabled: boolean): Promise<void> {
    const next = { ...skillState, [id]: { enabled } };
    setSkillState(next);
    await chrome.storage.local.set({ [STATE_KEY]: next });
  }

  return (
    <main>
      <div className="settings-header">
        <h1>{messages.title}</h1>
      </div>
      <div className="tabs" role="tablist">
        <button
          type="button"
          className="tab"
          role="tab"
          id="tab-general"
          data-tab="general"
          aria-controls="panel-general"
          aria-selected={tab === 'general'}
          onClick={() => activateTab('general')}
        >
          {messages.tabs.general}
        </button>
        <button
          type="button"
          className="tab"
          role="tab"
          id="tab-config"
          data-tab="config"
          aria-controls="panel-config"
          aria-selected={tab === 'config'}
          onClick={() => activateTab('config')}
        >
          {messages.tabs.providers}
        </button>
        <button
          type="button"
          className="tab"
          role="tab"
          id="tab-skills"
          data-tab="skills"
          aria-controls="skills"
          aria-selected={tab === 'skills'}
          onClick={() => activateTab('skills')}
        >
          {messages.tabs.skills}
        </button>
      </div>

      <section
        id="panel-general"
        className="tabpanel"
        data-tabpanel="general"
        role="tabpanel"
        aria-labelledby="tab-general"
        hidden={tab !== 'general'}
      >
        <div className="setting-row">
          <div className="setting-copy">
            <label className="setting-label" htmlFor="optionsLanguage">
              {messages.language}
            </label>
            <p id="optionsLanguageDescription" className="setting-description">
              {messages.general.languageDescription}
            </p>
          </div>
          <select
            className="setting-control"
            id="optionsLanguage"
            aria-describedby="optionsLanguageDescription"
            value={language}
            onChange={(e) =>
              changeLanguage(e.currentTarget.value as OptionsLanguage)
            }
          >
            <option value="en">{OPTIONS_LANGUAGE_LABELS.en}</option>
            <option value="zh-CN">{OPTIONS_LANGUAGE_LABELS['zh-CN']}</option>
          </select>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <label className="setting-label" htmlFor="optionsTranslationTarget">
              {messages.general.translationTarget}
            </label>
            <p
              id="optionsTranslationTargetDescription"
              className="setting-description"
            >
              {messages.general.translationTargetDescription}
            </p>
          </div>
          <select
            className="setting-control"
            id="optionsTranslationTarget"
            aria-describedby="optionsTranslationTargetDescription"
            value={translationTarget}
            onChange={(e) =>
              changeTranslationTarget(
                e.currentTarget.value as TranslationLanguage,
              )
            }
          >
            {TRANSLATION_LANGUAGES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section
        id="panel-config"
        className="tabpanel"
        data-tabpanel="config"
        role="tabpanel"
        aria-labelledby="tab-config"
        hidden={tab !== 'config'}
      >
        <p className="hint">{messages.providers.hint}</p>
        <aside
          className="privacy-notice"
          role="note"
          aria-label={messages.providers.privacyTitle}
        >
          <strong>{messages.providers.privacyTitle}</strong>
          <p>{messages.providers.privacyDescription}</p>
          <label className="privacy-consent">
            <input
              id="providerPrivacyConsent"
              type="checkbox"
              checked={privacyConsent}
              onChange={(event) => {
                const accepted = event.currentTarget.checked;
                setPrivacyConsent(accepted);
                void writePrivacyConsent(accepted);
              }}
            />
            <span>{messages.providers.privacyConsent}</span>
          </label>
        </aside>
        {providerStorageError && (
          <p id="providerStorageError" className="provider-error" role="alert">
            {messages.providers.storageError}
          </p>
        )}

        <div className="skills-toolbar">
          <button
            type="button"
            id="newProviderBtn"
            disabled={providerStorageError || !privacyConsent}
            onClick={() => openProviderEditor()}
          >
            {messages.providers.add}
          </button>
          <p id="providerStatus" role="status">
            {providerStatus ? messages.providers.status[providerStatus] : ''}
          </p>
        </div>

        <div id="providerList">
          {providers.length === 0 && (
            <p className="hint">{messages.providers.empty}</p>
          )}
          {providers.map((p) => (
            <div className="provider-row" data-id={p.id} key={p.id}>
              <div className="skill-row-main">
                <div className="skill-title">
                  <strong>{p.name}</strong>
                  {p.id === activeId && (
                    <span className="badge builtin">
                      {messages.providers.active}
                    </span>
                  )}
                </div>
                <span className="skill-match">
                  {p.provider} · {p.model || messages.providers.noModel}
                </span>
              </div>
              <div className="skill-row-actions">
                {p.id !== activeId && (
                  <button
                    type="button"
                    data-activate={p.id}
                    disabled={providerStorageError}
                    onClick={() => activateProvider(p.id)}
                  >
                    {messages.providers.use}
                  </button>
                )}
                <button
                  type="button"
                  data-edit={p.id}
                  disabled={providerStorageError}
                  onClick={() => openProviderEditor(p)}
                >
                  {messages.common.edit}
                </button>
                <button
                  type="button"
                  data-delete={p.id}
                  disabled={providerStorageError}
                  onClick={() => deleteProvider(p.id)}
                >
                  {messages.common.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        id="skills"
        className="tabpanel"
        data-tabpanel="skills"
        role="tabpanel"
        aria-labelledby="tab-skills"
        hidden={tab !== 'skills'}
      >
        <p className="hint">
          {messages.skills.hintBeforeWildcard}
          <code>*</code>
          {messages.skills.hintAfterWildcard}
        </p>

        <div className="skills-toolbar">
          <button type="button" id="newSkillBtn" onClick={() => openEditor()}>
            {messages.skills.add}
          </button>
          <p id="skillStatus" role="status">
            {skillStatus ? messages.skills.status[skillStatus] : ''}
          </p>
        </div>

        <div id="builtinSkills">
          {builtins.map((b) => (
            <div className="skill-row" key={b.id}>
              <div className="skill-row-main">
                <div className="skill-title">
                  <strong>{b.name}</strong>
                  <span className="badge builtin">
                    {messages.skills.builtIn}
                  </span>
                </div>
                <span className="skill-match">{b.description}</span>
                <span className="skill-match">
                  {b.match.length
                    ? messages.skills.matches(b.match)
                    : messages.skills.noPatterns}
                </span>
              </div>
              <div className="skill-row-actions">
                <label className="check">
                  <input
                    type="checkbox"
                    data-toggle={b.id}
                    checked={skillState[b.id]?.enabled !== false}
                    onChange={(e) =>
                      toggleBuiltin(b.id, e.currentTarget.checked)
                    }
                  />{' '}
                  {messages.common.enabled}
                </label>
              </div>
            </div>
          ))}
        </div>

        <div id="userSkillsList">
          {users.map((s) => (
            <div className="skill-row" data-id={s.id} key={s.id}>
              <div className="skill-row-main">
                <strong>{s.name}</strong>
                <span className="skill-match">
                  {s.match.join('  ·  ') || messages.skills.noPatterns}
                </span>
              </div>
              <div className="skill-row-actions">
                <label className="check">
                  <input
                    type="checkbox"
                    data-toggle={s.id}
                    checked={s.enabled}
                    onChange={(e) => toggleUser(s.id, e.currentTarget.checked)}
                  />{' '}
                  {messages.common.enabled}
                </label>
                <button
                  type="button"
                  data-edit={s.id}
                  onClick={() => openEditor(s)}
                >
                  {messages.common.edit}
                </button>
                <button
                  type="button"
                  data-delete={s.id}
                  onClick={() => deleteUser(s.id)}
                >
                  {messages.common.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <dialog
        id="providerDialog"
        aria-label={messages.providers.editorLabel}
        ref={providerDialogRef}
      >
        <form id="providerForm" autoComplete="off" onSubmit={onProviderSubmit}>
          <h3 id="providerFormTitle">
            {pEditId
              ? messages.providers.editTitle
              : messages.providers.newTitle}
          </h3>
          <label>
            {messages.common.name}
            <input
              id="providerName"
              type="text"
              placeholder="OpenAI"
              value={pEditName}
              onChange={(e) => setPEditName(e.target.value)}
            />
          </label>
          <label>
            {messages.providers.provider}
            <select
              id="providerType"
              value={pEditType}
              onChange={(e) => setPEditType(e.target.value as ProviderType)}
            >
              {PROVIDER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {messages.providers.baseUrl}
            <input
              id="providerBaseUrl"
              type="url"
              placeholder={messages.providers.baseUrlPlaceholder(pEditType)}
              value={pEditBaseUrl}
              aria-invalid={pEditBaseUrlError || undefined}
              aria-describedby={
                pEditBaseUrlError ? 'providerBaseUrlError' : undefined
              }
              onChange={(e) => {
                setPEditBaseUrl(e.target.value);
                setPEditBaseUrlError(false);
              }}
            />
            {pEditBaseUrlError && (
              <span
                id="providerBaseUrlError"
                className="field-error"
                role="alert"
              >
                {messages.providers.insecureBaseUrl}
              </span>
            )}
          </label>
          <label>
            {messages.providers.apiKey}
            <input
              id="providerApiKey"
              type="password"
              placeholder="sk-…"
              value={pEditApiKey}
              onChange={(e) => setPEditApiKey(e.target.value)}
            />
          </label>
          <label>
            {messages.providers.model}
            <input
              id="providerModel"
              type="text"
              placeholder="gpt-4o-mini"
              value={pEditModel}
              onChange={(e) => setPEditModel(e.target.value)}
            />
          </label>
          <div className="actions">
            <button type="submit" disabled={providerStorageError}>
              {messages.common.save}
            </button>
            <button
              id="providerCancel"
              type="button"
              onClick={() => providerDialogRef.current?.close()}
            >
              {messages.common.cancel}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        id="skillDialog"
        aria-label={messages.skills.editorLabel}
        ref={dialogRef}
      >
        <form id="skillForm" autoComplete="off" onSubmit={onSkillSubmit}>
          <h3 id="skillFormTitle">
            {editId ? messages.skills.editTitle : messages.skills.newTitle}
          </h3>
          <input type="hidden" id="skillId" value={editId} readOnly />
          <label>
            {messages.common.name}
            <input
              id="skillName"
              type="text"
              placeholder="github"
              required
              value={editName}
              ref={nameRef}
              onChange={(e) => setEditName(e.target.value)}
            />
          </label>
          <label>
            {messages.skills.description}
            <input
              id="skillDesc"
              type="text"
              placeholder={messages.skills.descriptionPlaceholder}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />
          </label>
          <label>
            {messages.skills.patterns}
            <textarea
              id="skillMatch"
              rows={2}
              placeholder="https://github.com/*&#10;https://*.github.com/*"
              value={editMatch}
              onChange={(e) => setEditMatch(e.target.value)}
            />
          </label>
          <label>
            {messages.skills.instructions}
            <textarea
              id="skillInstructions"
              rows={4}
              placeholder={messages.skills.instructionsPlaceholder}
              value={editInstructions}
              onChange={(e) => setEditInstructions(e.target.value)}
            />
          </label>
          <label className="check">
            <input
              id="skillEnabled"
              type="checkbox"
              checked={editEnabled}
              onChange={(e) => setEditEnabled(e.currentTarget.checked)}
            />{' '}
            {messages.common.enabled}
          </label>
          <div className="actions">
            <button type="submit">{messages.common.save}</button>
            <button
              id="skillCancel"
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              {messages.common.cancel}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
