// User-facing error text for the service worker's panel-facing surfaces.

import { ProviderVaultError } from './shared/providerVault';

/** Thrown when the provider data-use notice has not been accepted yet. */
export class ProviderConsentRequiredError extends Error {}

/** Turns a thrown value into a message that tells the user what to fix. */
export function friendlyError(err: unknown): string {
  if (err instanceof ProviderVaultError) {
    return 'Hibro couldn’t unlock the saved LLM provider settings. Open Settings for details.';
  }
  const msg = String((err instanceof Error && err.message) || err);
  if (msg.includes('Failed to fetch')) {
    return 'Could not reach the AI service. Check the base URL in the options page and your network connection.';
  }
  if (msg.includes('chrome://') || msg.includes('Cannot access')) {
    return 'This page is not supported (chrome:// pages, the Web Store, and other restricted pages cannot be accessed).';
  }
  if (msg.includes('Another debugger')) {
    return 'The page is being debugged by another tool (e.g. DevTools). Close it and try again.';
  }
  if (
    msg.includes('TAB_MESSAGE_TIMEOUT') ||
    msg.includes('No tab with id') ||
    msg.includes('Receiving end does not exist')
  ) {
    return 'Could not communicate with the page (the tab may have been open before the extension loaded). Reload the tab and try again.';
  }
  return msg;
}
