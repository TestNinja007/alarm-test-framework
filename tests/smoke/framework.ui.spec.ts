import { test, expect } from '../../src/fixtures.js';

/**
 * Checks on the browser half of the framework.
 *
 * Same purpose as the API plumbing checks: prove the harness works, so that
 * every other failure can be read as being about the product. Product
 * behaviour belongs in the designed test cases.
 */

test.describe('framework plumbing, browser @smoke', () => {
  test('the landing page is served to a signed-out visitor', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('landing-page')).toBeVisible();
  });

  test('a signed-out visitor is sent to sign in, not to the application', async ({ page }) => {
    await page.goto('/folders');

    await expect(page).toHaveURL(/\/login$/);
  });

  test('the signed-in fixture lands on the application', async ({ signedInPage }) => {
    await signedInPage.goto('/folders');

    // Signed in through the API rather than the form, so a broken sign-in form
    // fails one spec rather than all of them.
    await expect(signedInPage.getByTestId('app-topbar')).toBeVisible();
    await expect(signedInPage.getByTestId('folders-page')).toBeVisible();
  });

  test('test ids are present on the elements the suite will rely on', async ({ signedInPage }) => {
    await signedInPage.goto('/folders');

    // A selector contract check: if these disappear, specs written against
    // them break for a reason that has nothing to do with behaviour, and this
    // says so in one place.
    await expect(signedInPage.getByTestId('alarm-search-input')).toBeVisible();
    await expect(signedInPage.getByTestId('folder-create-open-button')).toBeVisible();
    await expect(signedInPage.getByTestId('alarm-create-unfiled-link')).toBeVisible();
  });
});
