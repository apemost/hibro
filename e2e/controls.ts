import type { Locator } from '@playwright/test';

/** Selects a value through a Hibro control's visible listbox. */
export async function selectValue(
  control: Locator,
  value: string,
): Promise<void> {
  await control.click();
  await control.page().getByRole('listbox').waitFor({ state: 'visible' });
  const options = control.page().getByRole('option');
  for (const option of await options.all()) {
    if ((await option.getAttribute('data-value')) === value) {
      await option.click();
      return;
    }
  }
  throw new Error(`Missing select option: ${value}`);
}
