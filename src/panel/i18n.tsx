// Side-panel translations backed by the language selected in Settings.

import {
  DEFAULT_UI_LANGUAGE,
  HIBRO_OPTIONS_KEY,
  readUiLanguage,
  resolveUiLanguage,
  type UiLanguage
} from "@/shared/language";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ToolState = "input-available" | "output-available" | "output-error";

export interface PanelMessages {
  history: string;
  conversationHistory: string;
  newChat: string;
  askTitle: string;
  askDescription: string;
  thinking: string;
  resizeMessageInput: string;
  composerPlaceholder: string;
  settings: string;
  openProviderSettings: string;
  stop: string;
  send: string;
  recentConversations: string;
  close: string;
  closeHistory: string;
  noConversations: string;
  conversationTitle: string;
  renameConversation: (title: string) => string;
  saveConversationTitle: string;
  cancelRename: string;
  deleteConversation: (title: string) => string;
  justNow: string;
  minutesAgo: (count: number) => string;
  hoursAgo: (count: number) => string;
  daysAgo: (count: number) => string;
  llmProvider: string;
  noProvider: string;
  copy: string;
  copied: string;
  explain: string;
  closeExplanation: string;
  genericError: string;
  showMore: string;
  showLess: string;
  htmlBlockView: string;
  code: string;
  preview: string;
  htmlPreview: string;
  invalidChart: (error: string) => string;
  generatedImage: string;
  remoteImage: string;
  inlineImageInvalid: string;
  remoteImageBlocked: string;
  remoteImageDisclosure: string;
  loadRemoteImage: (host: string) => string;
  loadOnce: string;
  imageLoading: string;
  remoteImageLoadError: string;
  toolStatus: Record<ToolState, string>;
  localizeStatus: (status: string) => string;
}

const PANEL_MESSAGES: Record<UiLanguage, PanelMessages> = {
  en: {
    history: "History",
    conversationHistory: "Conversation history",
    newChat: "New chat",
    askTitle: "Ask about this page",
    askDescription: "Ask a question, or describe an action to run on the page.",
    thinking: "Thinking…",
    resizeMessageInput: "Resize message input",
    composerPlaceholder: "Ask a question, or describe an action to run…",
    settings: "Settings",
    openProviderSettings: "Open provider settings",
    stop: "Stop",
    send: "Send",
    recentConversations: "Recent conversations",
    close: "Close",
    closeHistory: "Close history",
    noConversations: "No conversations yet.",
    conversationTitle: "Conversation title",
    renameConversation: (title) => `Rename conversation: ${title}`,
    saveConversationTitle: "Save conversation title",
    cancelRename: "Cancel rename",
    deleteConversation: (title) => `Delete conversation: ${title}`,
    justNow: "just now",
    minutesAgo: (count) => `${count}m`,
    hoursAgo: (count) => `${count}h`,
    daysAgo: (count) => `${count}d`,
    llmProvider: "LLM provider",
    noProvider: "No provider",
    copy: "Copy",
    copied: "Copied",
    explain: "Explain",
    closeExplanation: "Close explanation",
    genericError: "Something went wrong.",
    showMore: "Show more",
    showLess: "Show less",
    htmlBlockView: "HTML block view",
    code: "Code",
    preview: "Preview",
    htmlPreview: "HTML preview",
    invalidChart: (error) => `Invalid chart spec (${error}). Showing the source instead.`,
    generatedImage: "Generated image",
    remoteImage: "Remote image",
    inlineImageInvalid: "This image asset could not be displayed safely.",
    remoteImageBlocked: "This remote image address is blocked.",
    remoteImageDisclosure: "Loading contacts this host and reveals your IP address.",
    loadRemoteImage: (host) => `Load image from ${host}`,
    loadOnce: "Load once",
    imageLoading: "Loading image…",
    remoteImageLoadError: "This image could not be loaded safely.",
    toolStatus: {
      "input-available": "Running",
      "output-available": "Completed",
      "output-error": "Error"
    },
    localizeStatus: (status) => status
  },
  "zh-CN": {
    history: "历史记录",
    conversationHistory: "对话历史",
    newChat: "新对话",
    askTitle: "询问此页面",
    askDescription: "可以提出问题，也可以描述要在页面上执行的操作。",
    thinking: "思考中…",
    resizeMessageInput: "调整消息输入框大小",
    composerPlaceholder: "输入问题，或描述要执行的页面操作…",
    settings: "设置",
    openProviderSettings: "打开服务商设置",
    stop: "停止",
    send: "发送",
    recentConversations: "最近对话",
    close: "关闭",
    closeHistory: "关闭历史记录",
    noConversations: "暂无对话。",
    conversationTitle: "对话标题",
    renameConversation: (title) => `重命名对话：${title}`,
    saveConversationTitle: "保存对话标题",
    cancelRename: "取消重命名",
    deleteConversation: (title) => `删除对话：${title}`,
    justNow: "刚刚",
    minutesAgo: (count) => `${count} 分钟`,
    hoursAgo: (count) => `${count} 小时`,
    daysAgo: (count) => `${count} 天`,
    llmProvider: "LLM 服务商",
    noProvider: "尚未配置服务商",
    copy: "复制",
    copied: "已复制",
    explain: "解释",
    closeExplanation: "关闭解释",
    genericError: "出了点问题。",
    showMore: "展开",
    showLess: "收起",
    htmlBlockView: "HTML 代码块视图",
    code: "代码",
    preview: "预览",
    htmlPreview: "HTML 预览",
    invalidChart: (error) => `图表配置无效（${error}），已显示源代码。`,
    generatedImage: "生成的图片",
    remoteImage: "远程图片",
    inlineImageInvalid: "无法安全显示此图片资产。",
    remoteImageBlocked: "此远程图片地址已被阻止。",
    remoteImageDisclosure: "加载时会连接此主机，并向其暴露你的 IP 地址。",
    loadRemoteImage: (host) => `从 ${host} 加载图片`,
    loadOnce: "仅加载一次",
    imageLoading: "正在加载图片…",
    remoteImageLoadError: "无法安全加载此图片。",
    toolStatus: {
      "input-available": "运行中",
      "output-available": "已完成",
      "output-error": "错误"
    },
    localizeStatus: (status) => {
      if (status === "Working…") return "处理中…";
      if (status === "Reading the page…") return "正在读取页面…";
      return status;
    }
  }
};

interface PanelI18nValue {
  language: UiLanguage;
  messages: PanelMessages;
}

const PanelI18nContext = createContext<PanelI18nValue>({
  language: DEFAULT_UI_LANGUAGE,
  messages: PANEL_MESSAGES[DEFAULT_UI_LANGUAGE]
});

/** Provides live panel translations from the shared storage preference. */
export function PanelI18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<UiLanguage>(DEFAULT_UI_LANGUAGE);

  useEffect(() => {
    let alive = true;
    let storageVersion = 0;
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[HIBRO_OPTIONS_KEY]) return;
      storageVersion += 1;
      setLanguage(resolveUiLanguage(changes[HIBRO_OPTIONS_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    const readVersion = storageVersion;
    void readUiLanguage().then((stored) => {
      if (alive && storageVersion === readVersion) setLanguage(stored);
    });
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(
    () => ({ language, messages: PANEL_MESSAGES[language] }),
    [language]
  );
  return <PanelI18nContext.Provider value={value}>{children}</PanelI18nContext.Provider>;
}

/** Returns the current side-panel language and translated UI messages. */
export function usePanelI18n(): PanelI18nValue {
  return useContext(PanelI18nContext);
}
