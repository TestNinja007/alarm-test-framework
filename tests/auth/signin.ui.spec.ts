import { test, expect } from '../../src/fixtures.js';

/**
 * TC13 — signing in with an empty password, through the form.
 * Requirement R-29, and rule A-02.
 *
 * The case asks for three things: the submission is refused, a field-level
 * error appears on the password, and **no request is sent**. That last clause
 * is the one that makes it a client-side test rather than a server-side one,
 * and it is why this cannot be an API spec: an API spec can only observe the
 * request that a correct implementation never makes.
 *
 * A-02 is what entitles the case to ask. It says validation is field-level
 * and inline, "client- and server-side".
 */

test.describe('signing in @ui @auth', () => {
  test('TC13: an empty password is caught before anything is sent', async ({ page }) => {
    const attempts: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/auth/login')) attempts.push(request.method());
    });

    await page.goto('/login');
    await expect(page.getByTestId('login-page')).toBeVisible();

    await page.getByTestId('login-email-input').fill('someone@example.test');
    // Password deliberately left empty.
    await page.getByTestId('login-submit-button').click();

    // The error lands on the field that is wrong, not in a banner that makes
    // the person re-read the whole form to find out which one.
    await expect(
      page.getByTestId('login-password-input-error'),
      'an empty password should be reported on the password field',
    ).toBeVisible();

    // Still on the form.
    await expect(page).toHaveURL(/\/login$/);

    /*
     * And nothing was sent. A form that posts an empty password and renders
     * whatever comes back satisfies the first two assertions and fails this
     * one — it has moved the check to the server and told the person later.
     */
    expect(attempts, 'no sign-in request should have been made').toEqual([]);
  });
});
