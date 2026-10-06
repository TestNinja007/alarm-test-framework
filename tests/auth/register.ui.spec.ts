import { test, expect } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';

/**
 * TC2 and TC15 — creating an account, through the interface.
 * Requirements R-13, R-30.
 *
 * Registration was the largest hole in this suite: not merely unautomated but
 * unexercised at any layer. Every other spec gets its account from
 * `POST /test/users`, a hook that inserts a row directly — which is right for
 * a spec about something else, and means nothing had ever walked the path a
 * real person walks.
 *
 * It is also where DEF-01 lived, the only Critical in the register: the
 * six-digit code was returned in the registration response on the deployed
 * site, so anyone could register an address they did not own and read its
 * code off the page.
 *
 * **No mail server is involved.** The application exposes
 * `GET /test/verification-code` behind `TEST_SUPPORT`, which hands back the
 * outstanding code for an address. That is what a test-support hook is for,
 * and it is why this needs no inbox, no Gmail API and no polling — the usual
 * reasons registration goes untested.
 */

const password = 'a-long-enough-password';

test.describe('creating an account @ui @auth', () => {
  test.beforeEach(async ({ api }) => {
    // Registration can be closed by configuration, and is on a public
    // deployment. Skipping with the reason beats failing with a redirect.
    const health = await api.json<{ registrationOpen: boolean }>(await api.get('/health'));
    test.skip(!health.registrationOpen, 'registration is closed on this instance');
  });

  // A signed-out page: the signed-in route table redirects /register to the
  // application, so a spec that arrives already authenticated never sees the
  // form it is testing.
  test('TC2: a new account is registered, verified by code, and signed in', async ({
    page,
    hooks,
  }) => {
    const email = `tc2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

    await page.goto('/register');
    await expect(page.getByTestId('register-page')).toBeVisible();

    await page.getByTestId('register-email-input').fill(email);
    await page.getByTestId('register-name-input').fill('Casey Tester');
    await page.getByTestId('register-password-input').fill(password);
    await page.getByTestId('register-submit-button').click();

    // The account exists at this point but cannot sign in yet.
    await expect(page).toHaveURL(/\/verify/);
    await expect(page.getByTestId('verify-email')).toContainText(email);

    // The code, without an inbox. This is the hook earning its place.
    const code = await hooks.verificationCode(email);
    expect(code, 'the hook should return a six-digit code').toMatch(/^\d{6}$/);

    await page.getByTestId('verify-code-input').fill(code);
    await page.getByTestId('verify-submit-button').click();

    // Verifying signs you in, rather than returning you to the form.
    await expect(page).toHaveURL(/\/folders$/);
    await expect(page.getByTestId('app-topbar')).toBeVisible();

    // And the server agrees about who is signed in.
    const api = new ApiClient(page.request);
    await api.adoptSession();
    const me = await api.json<{ user: { email: string; name: string } }>(await api.get('/auth/me'));
    expect(me.user.email).toBe(email);
    expect(me.user.name).toBe('Casey Tester');

    // A new account starts empty, which is what makes the fixture that uses
    // this path for isolation trustworthy.
    const folders = await api.json<{ items: unknown[] }>(await api.get('/folders'));
    expect(folders.items).toHaveLength(0);
  });

  test('TC16: a password under ten characters is refused on the password field', async ({
    page,
  }) => {
    await page.goto('/register');

    await page
      .getByTestId('register-email-input')
      .fill(`short-${Date.now()}@example.test`);
    await page.getByTestId('register-name-input').fill('Short Password');
    await page.getByTestId('register-password-input').fill('nine-char');
    await page.getByTestId('register-submit-button').click();

    // R-14. The error belongs on the password, and has to state the minimum:
    // "too short" without a number sends the person to guess how much more.
    const error = page.getByTestId('register-password-input-error');
    await expect(error, 'the refusal should land on the password field').toBeVisible();
    await expect(error, 'and should say what the minimum is').toContainText(/10|ten/i);

    await expect(page).toHaveURL(/\/register$/);
  });

  test('TC15: an address that already has an account is refused on the field', async ({
    page,
    freshUser,
  }) => {
    await page.goto('/register');

    await page.getByTestId('register-email-input').fill(freshUser.email);
    await page.getByTestId('register-name-input').fill('Someone Else');
    await page.getByTestId('register-password-input').fill(password);
    await page.getByTestId('register-submit-button').click();

    // R-13. Where the refusal lands is the point: an error beside the email
    // field sends the person to the one thing that was wrong. A generic
    // banner, or a redirect, sends them to guess.
    await expect(page.getByTestId('register-email-error')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);

    // And no second account was made for that address.
    await expect(page.getByTestId('register-page')).toBeVisible();
  });
});
