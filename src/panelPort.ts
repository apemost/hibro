// Port-sender checks shared by the worker features Hibro's own pages drive.

export const PANEL_PAGE_PATH = '/src/panel.html';
export const POPUP_PAGE_PATH = '/src/popup.html';

/**
 * Confirms a port was opened by one of Hibro's own extension pages. Content
 * scripts can also open runtime ports, so features that spend credentials or
 * act on a tab verify the sender instead of trusting the port name. Each
 * feature passes the pages it serves, so a surface only reaches what it needs.
 */
export function isTrustedExtensionPort(
  port: chrome.runtime.Port,
  allowedPaths: readonly string[],
): boolean {
  const sender = port.sender;
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin;
  if (sender.origin && sender.origin !== extensionOrigin) return false;
  if (!sender.url) return false;
  try {
    const senderUrl = new URL(sender.url);
    return (
      senderUrl.origin === extensionOrigin &&
      allowedPaths.includes(senderUrl.pathname)
    );
  } catch {
    return false;
  }
}
