import { test, expect } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';
import { Alarms } from '../../src/pages/alarms.js';
import { Dashboard } from '../../src/pages/dashboard.js';
import { Wizard } from '../../src/pages/wizard.js';

/**
 * TC3 — Create Alarm, through the interface. Requirements R-31, R-24.
 *
 * The API specs in this suite prove the server's half: that it accepts a valid
 * alarm and refuses an invalid one. They open no browser, so they say nothing
 * about whether a person can actually get an alarm made. DEF-10 is what that
 * blind spot costs — the API supported unfiled alarms for a day while the
 * interface had no button to make one, and every API spec stayed green.
 *
 * The pattern throughout: **the clicks are the test, the API is the oracle.**
 * The wizard is driven the way a person drives it, and then the server is
 * asked what it actually stored. Either half alone misses a class of fault —
 * a form that reports success and writes nothing, or a field that saves to the
 * wrong column.
 */

interface SavedAlarm {
  id: string;
  name: string;
  timeOfDay: string;
  timezone: string;
  startDate: string;
  enabled: boolean;
  folderId: string | null;
  speechText: string | null;
}

test.describe('creating an alarm through the wizard @ui', () => {
  test('TC3: an alarm made in the wizard is saved, listed, and has occurrences', async ({
    freshUserPage,
  }) => {
    const dashboard = new Dashboard(freshUserPage);
    const wizard = new Wizard(freshUserPage);
    const alarms = new Alarms(freshUserPage);

    await dashboard.goto();
    await expect(dashboard.root).toBeVisible();

    // No group chosen: the route DEF-10 was missing entirely.
    await dashboard.newUnfiledAlarm();

    await wizard.expectStep(wizard.BASICS);
    await wizard.fillName('Stretch');
    await wizard.fillSpokenMessage('Stand up and stretch');
    await wizard.next();

    await wizard.expectStep(wizard.SCHEDULE);
    await wizard.fillTimezone('Europe/London');
    await wizard.fillTime('09:15');
    await wizard.fillStartDate('2027-01-04');
    await wizard.next();

    await wizard.expectStep(wizard.REPETITION);
    await wizard.chooseRule('daily');
    await wizard.next();

    // The review step is the last thing a person sees before committing, so
    // what it shows is part of the case rather than a staging post.
    await wizard.expectStep(wizard.REVIEW);
    await expect(wizard.reviewValue('name')).toHaveText('Stretch');
    await expect(wizard.reviewValue('time')).toContainText('09:15');
    await expect(wizard.reviewValue('time')).toContainText('Europe/London');
    await expect(wizard.reviewValue('start')).toHaveText('2027-01-04');

    await wizard.submit();

    // It appears in the list it belongs to.
    await expect(freshUserPage).toHaveURL(/\/folders\/unfiled$/);
    await expect(alarms.row('Stretch')).toBeVisible();

    // And the server holds what the form said. Reading the id off the row the
    // spec just looked at is what ties the two halves together.
    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();

    const id = await alarms.idOf('Stretch');
    const saved = await api.json<SavedAlarm>(await api.get(`/alarms/${id}`));

    expect(saved).toMatchObject({
      name: 'Stretch',
      timeOfDay: '09:15',
      timezone: 'Europe/London',
      startDate: '2027-01-04',
      enabled: true,
      folderId: null,
      speechText: 'Stand up and stretch',
    });

    // R-31 does not stop at "it appears in their list" — it also says the
    // alarm shows up in the occurrence preview, which is the only place a
    // person can check that the schedule means what they intended.
    await alarms.openPreview('Stretch');
    await expect(alarms.occurrenceRows.first()).toBeVisible();
  });

  test('TC3b: the wizard will not advance past a missing name', async ({ freshUserPage }) => {
    const dashboard = new Dashboard(freshUserPage);
    const wizard = new Wizard(freshUserPage);

    await dashboard.goto();
    await dashboard.newUnfiledAlarm();

    await wizard.expectStep(wizard.BASICS);

    // A-03: each step checks what it needs before it will advance, so a
    // missing name is caught on step one rather than three screens later at
    // submit. The control stays enabled and the attempt is refused -- so the
    // assertion is that the step did not change and the error names the
    // field, not that a button went grey. Which of those the app does is an
    // implementation choice; staying on step one is the rule.
    await wizard.next();

    await wizard.expectStep(wizard.BASICS);
    await expect(wizard.fieldError('name')).toBeVisible();

    // And it clears the way once the step has what it needs.
    await wizard.fillName('Named now');
    await wizard.next();
    await wizard.expectStep(wizard.SCHEDULE);
  });
});
