import type { ProviderType } from '@/shared/providers';
import {
  DEFAULT_UI_LANGUAGE,
  HIBRO_OPTIONS_KEY,
  UI_LANGUAGE_LABELS,
  readTranslationTarget,
  readUiLanguage,
  resolveTranslationTarget,
  resolveUiLanguage,
  writeTranslationTarget,
  writeUiLanguage,
  type TranslationLanguage,
  type UiLanguage,
} from '@/shared/language';

export type OptionsLanguage = UiLanguage;

export const OPTIONS_KEY = HIBRO_OPTIONS_KEY;
export const DEFAULT_OPTIONS_LANGUAGE = DEFAULT_UI_LANGUAGE;
export const OPTIONS_LANGUAGE_LABELS = UI_LANGUAGE_LABELS;

interface OptionsMessages {
  title: string;
  language: string;
  tabs: {
    general: string;
    providers: string;
    skills: string;
  };
  general: {
    languageDescription: string;
    translationTarget: string;
    translationTargetDescription: string;
  };
  common: {
    name: string;
    edit: string;
    delete: string;
    save: string;
    cancel: string;
    enabled: string;
  };
  providers: {
    hint: string;
    privacyTitle: string;
    privacyDescription: string;
    privacyConsent: string;
    add: string;
    empty: string;
    storageError: string;
    active: string;
    noModel: string;
    use: string;
    status: Record<'saved' | 'added' | 'deleted', string>;
    editorLabel: string;
    editTitle: string;
    newTitle: string;
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    insecureBaseUrl: string;
    baseUrlPlaceholder: (provider: ProviderType) => string;
  };
  skills: {
    hintBeforeWildcard: string;
    hintAfterWildcard: string;
    add: string;
    builtIn: string;
    matches: (patterns: string[]) => string;
    noPatterns: string;
    status: Record<'created' | 'saved' | 'deleted', string>;
    editorLabel: string;
    editTitle: string;
    newTitle: string;
    description: string;
    descriptionPlaceholder: string;
    patterns: string;
    instructions: string;
    instructionsPlaceholder: string;
  };
}

export const OPTIONS_MESSAGES: Record<OptionsLanguage, OptionsMessages> = {
  en: {
    title: 'Hibro Settings',
    language: 'Language',
    tabs: {
      general: 'General',
      providers: 'LLM providers',
      skills: 'Agent skills',
    },
    general: {
      languageDescription:
        'Choose the language used in Settings and the side panel.',
      translationTarget: 'Translation language',
      translationTargetDescription:
        'Language the side panel translates page text into.',
    },
    common: {
      name: 'Name',
      edit: 'Edit',
      delete: 'Delete',
      save: 'Save',
      cancel: 'Cancel',
      enabled: 'Enabled',
    },
    providers: {
      hint: 'Add one or more LLM providers, then pick the one the side panel uses.',
      privacyTitle: 'Before you connect',
      privacyDescription:
        "Hibro keeps provider settings and recent conversations in this browser. When you chat, it sends your messages, page address, content it reads, and matching skill instructions directly to the active LLM provider. Your API key is used only to connect to that provider. The Hibro developer does not receive this data. The provider's privacy and retention terms apply.",
      privacyConsent: 'I understand and agree to this data use.',
      add: '+ Add provider',
      empty: 'No providers yet. Add one to get started.',
      storageError:
        'Hibro couldn’t unlock the saved LLM providers. The saved data was left unchanged.',
      active: 'Active',
      noModel: '(no model)',
      use: 'Use',
      status: {
        saved: 'Saved.',
        added: 'Added.',
        deleted: 'Deleted.',
      },
      editorLabel: 'Provider editor',
      editTitle: 'Edit provider',
      newTitle: 'New provider',
      provider: 'Provider',
      baseUrl: 'Base URL',
      apiKey: 'API Key',
      model: 'Model',
      insecureBaseUrl:
        'Use HTTPS for remote providers. HTTP is allowed only for localhost and loopback addresses.',
      baseUrlPlaceholder: (provider) =>
        provider === 'anthropic'
          ? 'https://api.anthropic.com/v1 (optional)'
          : provider === 'openai'
            ? 'https://api.openai.com/v1 (optional)'
            : 'https://api.openai.com/v1',
    },
    skills: {
      hintBeforeWildcard:
        'Skills teach the agent how a specific site works. A skill activates on pages whose URL matches one of its patterns (',
      hintAfterWildcard: ' matches anything).',
      add: '+ New skill',
      builtIn: 'Built-in',
      matches: (patterns) => `Matches: ${patterns.join('  ·  ')}`,
      noPatterns: '(no patterns)',
      status: {
        created: 'Created.',
        saved: 'Saved.',
        deleted: 'Deleted.',
      },
      editorLabel: 'Skill editor',
      editTitle: 'Edit skill',
      newTitle: 'New skill',
      description: 'Description',
      descriptionPlaceholder: 'Navigate GitHub',
      patterns: 'URL patterns (one per line)',
      instructions: 'Instructions',
      instructionsPlaceholder:
        'The search box is input#q. Submit with button#go.',
    },
  },
  'zh-CN': {
    title: 'Hibro 设置',
    language: '语言',
    tabs: {
      general: '常规',
      providers: 'LLM 服务商',
      skills: '智能体技能',
    },
    general: {
      languageDescription: '选择设置页和侧边栏的显示语言。',
      translationTarget: '翻译目标语言',
      translationTargetDescription: '侧边栏将页面正文翻译成的语言。',
    },
    common: {
      name: '名称',
      edit: '编辑',
      delete: '删除',
      save: '保存',
      cancel: '取消',
      enabled: '启用',
    },
    providers: {
      hint: '添加一个或多个 LLM 服务商，然后选择侧边栏要使用的服务商。',
      privacyTitle: '连接前请了解',
      privacyDescription:
        'Hibro 会把服务商配置和最近的对话保存在当前浏览器中。聊天时，它会把你的消息、页面地址、读取到的页面内容以及匹配的技能说明直接发送给当前 LLM 服务商。API 密钥仅用于连接该服务商。Hibro 开发者不会收到这些数据，服务商自身的隐私和数据保留条款仍然适用。',
      privacyConsent: '我已了解并同意上述数据用途。',
      add: '+ 添加服务商',
      empty: '还没有服务商。添加一个即可开始使用。',
      storageError: 'Hibro 无法解密已保存的 LLM 服务商配置。原有数据未被修改。',
      active: '使用中',
      noModel: '（未设置模型）',
      use: '使用',
      status: {
        saved: '已保存。',
        added: '已添加。',
        deleted: '已删除。',
      },
      editorLabel: '服务商编辑窗口',
      editTitle: '编辑服务商',
      newTitle: '新增服务商',
      provider: '服务商',
      baseUrl: 'Base URL',
      apiKey: 'API 密钥',
      model: '模型',
      insecureBaseUrl:
        '远程服务商必须使用 HTTPS。HTTP 仅可用于 localhost 和本机回环地址。',
      baseUrlPlaceholder: (provider) =>
        provider === 'anthropic'
          ? 'https://api.anthropic.com/v1（可选）'
          : provider === 'openai'
            ? 'https://api.openai.com/v1（可选）'
            : 'https://api.openai.com/v1',
    },
    skills: {
      hintBeforeWildcard:
        '技能告诉智能体如何使用特定网站。当页面 URL 与任一模式匹配时，相应技能会启用（',
      hintAfterWildcard: ' 可以匹配任意内容）。',
      add: '+ 新建技能',
      builtIn: '内置',
      matches: (patterns) => `匹配网址：${patterns.join('  ·  ')}`,
      noPatterns: '（无匹配模式）',
      status: {
        created: '已创建。',
        saved: '已保存。',
        deleted: '已删除。',
      },
      editorLabel: '技能编辑窗口',
      editTitle: '编辑技能',
      newTitle: '新建技能',
      description: '描述',
      descriptionPlaceholder: '浏览 GitHub',
      patterns: 'URL 匹配模式（每行一个）',
      instructions: '指令',
      instructionsPlaceholder: '搜索框对应 input#q，提交按钮对应 button#go。',
    },
  },
};

/** Returns the Settings language stored in the General options object. */
export function resolveOptionsLanguage(value: unknown): OptionsLanguage {
  return resolveUiLanguage(value);
}

/** Reads the language shared by Settings and the side panel. */
export async function readOptionsLanguage(): Promise<OptionsLanguage> {
  return readUiLanguage();
}

/** Stores the language shared by Settings and the side panel. */
export async function writeOptionsLanguage(
  language: OptionsLanguage,
): Promise<void> {
  await writeUiLanguage(language);
}

/** Returns the translation target stored in the General options object. */
export function resolveOptionsTranslationTarget(
  value: unknown,
): TranslationLanguage {
  return resolveTranslationTarget(value);
}

/** Reads the language page translation renders into. */
export async function readOptionsTranslationTarget(): Promise<TranslationLanguage> {
  return readTranslationTarget();
}

/** Stores the language page translation renders into. */
export async function writeOptionsTranslationTarget(
  target: TranslationLanguage,
): Promise<void> {
  await writeTranslationTarget(target);
}
