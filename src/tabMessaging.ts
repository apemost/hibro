// Content-script messaging for the service worker, with one recovery attempt
// for tabs that predate the current extension install or reload.

const TAB_MESSAGE_TIMEOUT_MS = 8000;

function sendToTabOnce<T>(
  tabId: number,
  msg: { type: string; [key: string]: unknown },
): Promise<T> {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg) as Promise<T>,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('TAB_MESSAGE_TIMEOUT')),
        TAB_MESSAGE_TIMEOUT_MS,
      ),
    ),
  ]);
}

function isMissingContentScriptError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Receiving end does not exist');
}

async function injectContentScript(tabId: number): Promise<void> {
  const files =
    chrome.runtime
      .getManifest()
      .content_scripts?.flatMap((entry) => entry.js ?? []) ?? [];
  if (!files.length) throw new Error('Hibro content script bundle is missing.');
  await chrome.scripting.executeScript({
    target: { tabId },
    files,
    injectImmediately: true,
  });
}

/**
 * A read-only content-script question that never injects or retries. Status
 * probes use it so polling a tab cannot inject the bundle into pages the user
 * never asked Hibro to touch; an unreachable tab answers null.
 */
export async function probeTab<T>(
  tabId: number,
  msg: { type: string; [key: string]: unknown },
): Promise<T | null> {
  try {
    return await sendToTabOnce<T>(tabId, msg);
  } catch {
    return null;
  }
}

// Tabs that predate an extension install or reload do not receive the current
// content script. Retry once only when Chrome confirms that no receiver exists.
// A timeout may be a live page reader doing expensive work, so reinjecting on
// that signal would add another listener and repeat the same read.
export async function sendToTab<T>(
  tabId: number,
  msg: { type: string; [key: string]: unknown },
): Promise<T> {
  try {
    return await sendToTabOnce<T>(tabId, msg);
  } catch (err) {
    if (!isMissingContentScriptError(err)) throw err;
    await injectContentScript(tabId);
    return sendToTabOnce<T>(tabId, msg);
  }
}
