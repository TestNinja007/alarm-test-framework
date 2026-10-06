import { test, expect } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';
import { Alarms } from '../../src/pages/alarms.js';
import { Dashboard } from '../../src/pages/dashboard.js';
import { Wizard } from '../../src/pages/wizard.js';

/**
 * TC47 to TC50 and TC57 — compatibility, and input that looks like code.
 * Requirements R-12, R-25, R-31.
 *
 * These are the specs the three-engine matrix exists for. Every other browser
 * spec would pass on one engine and tell you almost as much; these are about
 * the places where engines genuinely differ — native date and time pickers,
 * the speech synthesiser, the timezone list — and they are written to assert
 * the capability rather than the appearance, because the appearance is
 * supposed to differ.
 *
 * TC47 is deliberately not an assertion about WHICH voice. Engines ship
 * different ones and that is not a defect; failing to resolve any voice at
 * all is.
 */

test.describe('compatibility @ui @compatibility', () => {
  test('TC48: the time and start date can be set, and are retained', async ({ freshUserPage }) => {
    const dashboard = new Dashboard(freshUserPage);
    const wizard = new Wizard(freshUserPage);

    await dashboard.goto();
    await dashboard.newUnfiledAlarm();
    await wizard.fillName(`Schedule ${Date.now()}`);
    await wizard.next();
    await wizard.expectStep(wizard.SCHEDULE);

    await wizard.fillTime('14:35');
    await wizard.fillStartDate('2027-06-15');

    /*
     * Whatever the picker looks like — and it looks entirely different on
     * each engine — the value the form holds afterwards is the contract. An
     * engine whose date input silently rejects the format gives back an empty
     * string here, which is the failure this is for.
     */
    await expect(freshUserPage.getByTestId('alarm-time-input')).toHaveValue('14:35');
    await expect(freshUserPage.getByTestId('alarm-start-date-input')).toHaveValue('2027-06-15');

    // And they survive leaving the step and coming back.
    await wizard.next();
    await wizard.expectStep(wizard.REPETITION);
    await wizard.back();
    await wizard.expectStep(wizard.SCHEDULE);

    await expect(freshUserPage.getByTestId('alarm-time-input')).toHaveValue('14:35');
    await expect(freshUserPage.getByTestId('alarm-start-date-input')).toHaveValue('2027-06-15');
  });

  test('TC47: a voice resolves, or the engine says plainly that it cannot speak', async ({
    freshUserPage,
  }, testInfo) => {
    const dashboard = new Dashboard(freshUserPage);
    const wizard = new Wizard(freshUserPage);

    await dashboard.goto();
    await dashboard.newUnfiledAlarm();
    await wizard.fillName(`Voice ${Date.now()}`);
    await wizard.fillSpokenMessage('Time to stand up');

    const resolved = freshUserPage.getByTestId('alarm-speech-resolved-voice');
    await expect(resolved, 'the form should say which voice it would use').toBeVisible();
    const said = (await resolved.textContent())?.trim() ?? '';

    /*
     * The case says differences between engines are RECORDED rather than
     * asserted, and it is right to: voices belong to the operating system,
     * a CI runner has almost none, and a spec that demanded a particular
     * voice would fail for being run somewhere else. So this asserts the two
     * things that are the application's own doing — that it answers at all,
     * and that it answers honestly when it cannot speak — and attaches what
     * each engine actually said.
     */
    await testInfo.attach(`resolved-voice-${testInfo.project.name}`, {
      body: said,
      contentType: 'text/plain',
    });

    expect(said, 'it should either name a voice or say it cannot speak').toMatch(
      /On this computer that is |cannot speak/,
    );

    // What it must never do is claim a voice it has not got.
    const voices = await freshUserPage.evaluate(() =>
      'speechSynthesis' in window ? window.speechSynthesis.getVoices().length : -1,
    );
    if (voices === 0) {
      expect(
        said,
        'with no voices installed it should not name one',
      ).toMatch(/whichever voice is available|cannot speak/);
    }
  });

  test('TC49: the timezone field offers IANA names including the default', async ({
    freshUserPage,
  }) => {
    const dashboard = new Dashboard(freshUserPage);
    const wizard = new Wizard(freshUserPage);

    await dashboard.goto();
    await dashboard.newUnfiledAlarm();
    await wizard.fillName(`Zones ${Date.now()}`);
    await wizard.next();
    await wizard.expectStep(wizard.SCHEDULE);

    const field = freshUserPage.getByTestId('alarm-timezone-input');
    // The form arrives with a default; R-12 requires it to be a valid IANA
    // name, and an empty one would make every alarm created here invalid.
    const current = await field.inputValue();
    expect(current, 'the default timezone should be an IANA name').toMatch(/^[A-Za-z_]+\/[A-Za-z_+-]+$/);

    /*
     * The list itself comes from the engine. Intl.supportedValuesOf is where
     * it comes from and is the thing that differs: an engine without it leaves
     * the field with nothing to offer, which is invisible until someone tries
     * to change their timezone.
     */
    const offered = await freshUserPage.evaluate(() => {
      const supported = (
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf;
      return supported ? supported('timeZone') : [];
    });
    expect(offered.length, 'the engine should offer a non-empty timezone list').toBeGreaterThan(50);
    expect(offered, 'and the default should be among them').toContain(current);
  });

  test('TC50: the layout works at phone width', async ({ freshUserPage }) => {
    await freshUserPage.setViewportSize({ width: 390, height: 844 });

    const dashboard = new Dashboard(freshUserPage);
    const wizard = new Wizard(freshUserPage);
    await dashboard.goto();

    const overflows = async () =>
      freshUserPage.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

    expect(await overflows(), 'the dashboard should not scroll sideways at 390px').toBe(false);

    /*
     * Reachable, which is not the same as visible without scrolling. A form
     * taller than a phone is ordinary and scrolling down to its button is how
     * phones work; what is not ordinary is a control that cannot be brought
     * into view at all, or that is pushed outside the page sideways.
     */
    const reachable = async (testId: string) => {
      const control = freshUserPage.getByTestId(testId);
      await control.scrollIntoViewIfNeeded();
      await expect(control, `${testId} should be reachable at phone width`).toBeInViewport();
    };

    await expect(dashboard.groupListContainer).toBeVisible();
    await reachable('folder-create-open-button');
    await reachable('alarm-create-unfiled-link');

    await dashboard.newUnfiledAlarm();
    await wizard.expectStep(wizard.BASICS);
    expect(await overflows(), 'the wizard should not scroll sideways at 390px').toBe(false);
    await reachable('alarm-name-input');
    await reachable('wizard-next-button');
  });
});

test.describe('input that looks like code @ui @security', () => {
  test('TC57: a name with quotes and markup is stored and shown as literal text', async ({
    freshUserPage,
  }) => {
    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();

    // A single quote and a semicolon: the shape of an injection, and a
    // perfectly ordinary name for an alarm about someone's evening.
    const punctuated = `Dad's meds; 8pm ${Date.now()}`;
    const stored = await api.json<{ id: string; name: string }>(
      await api.post('/alarms', {
        name: punctuated,
        timeOfDay: '20:00',
        timezone: 'UTC',
        startDate: '2027-07-01',
        rule: { type: 'daily' },
      }),
    );
    expect(stored.name, 'the name should round-trip exactly').toBe(punctuated);

    const markup = `<script>window.__injected = true</script> ${Date.now()}`;
    await api.json(
      await api.post('/alarms', {
        name: markup,
        timeOfDay: '20:05',
        timezone: 'UTC',
        startDate: '2027-07-01',
        rule: { type: 'daily' },
      }),
    );

    const alarms = new Alarms(freshUserPage);
    await alarms.gotoUnfiled();

    // Shown as text, character for character.
    await expect(alarms.rowNamed(punctuated)).toBeVisible();
    await expect(alarms.rowNamed(markup)).toBeVisible();

    /*
     * And not executed. React escapes by default, so this asserts that nobody
     * has reached for dangerouslySetInnerHTML on the way to rendering a name
     * — which is the one change that would turn this field into a hole.
     */
    const injected = await freshUserPage.evaluate(
      () => (window as unknown as { __injected?: boolean }).__injected === true,
    );
    expect(injected, 'the markup must not have executed').toBe(false);
    expect(
      await freshUserPage.locator('script').filter({ hasText: 'window.__injected' }).count(),
      'and must not be present as a script element',
    ).toBe(0);
  });
});
