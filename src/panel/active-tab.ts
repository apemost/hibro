// Resolves the tab the side panel acts on.

/** Returns the active tab of the panel's window, or throws when there is none. */
export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) {
    throw new Error('Could not find the active tab.');
  }
  return tab;
}
