// Configures the provider used by the evaluation harness.

/** Saves the evaluation provider through the Settings form. */
export async function configureProvider(context, extensionId, profile) {
  const page = await context.newPage();
  const name = profile.name || 'Evaluation';
  try {
    await page.goto(`chrome-extension://${extensionId}/src/options.html`);
    await page.click('#tab-config');
    const consent = page.locator('#providerPrivacyConsent');
    if (!(await consent.isChecked())) await consent.check();
    await page.click('#newProviderBtn');
    await page.fill('#providerName', name);
    await page.selectOption('#providerType', profile.provider);
    await page.fill('#providerBaseUrl', profile.baseUrl || '');
    await page.fill('#providerApiKey', profile.apiKey);
    await page.fill('#providerModel', profile.model);
    await page.click('#providerForm button[type="submit"]');

    const row = page.locator('#providerList .provider-row', { hasText: name });
    await row.waitFor({ state: 'visible' });
    const activate = row.locator('button[data-activate]');
    if (await activate.count()) {
      await activate.click();
      await activate.waitFor({ state: 'detached' });
    }
  } finally {
    await page.close();
  }
}
