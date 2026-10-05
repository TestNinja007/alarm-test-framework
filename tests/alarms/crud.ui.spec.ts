import { test, expect } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';
import { Alarms } from '../../src/pages/alarms.js';
import { Wizard } from '../../src/pages/wizard.js';

/**
 * TC9 — editing and deleting an alarm, through the interface.
 * Requirements R-31, R-34.
 *
 * Creating is covered by TC3. This is the other half of the life cycle, and
 * the half where a wrong result is quietest: an edit that saves to the wrong
 * field, or a delete that removes the row from the page without removing the
 * record, both look exactly like success.
 *
 * So both halves are checked twice over — once through the interface, which is
 * what a person sees, and once through the API, which is what actually
 * happened. The second assertion is the one that would catch a row vanishing
 * from a cache while the alarm is still scheduled.
 */

const alarmBody = (name: string, timeOfDay: string) => ({
  name,
  timeOfDay,
  timezone: 'UTC',
  startDate: '2027-01-04',
  rule: { type: 'daily' },
});

interface SavedAlarm {
  name: string;
  timeOfDay: string;
}

test.describe('editing and deleting an alarm @ui', () => {
  test('TC9: an alarm can be edited, and the change is stored', async ({ freshUserPage }) => {
    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();
    await api.json(await api.post('/alarms', alarmBody('Standup', '09:30')));

    const alarms = new Alarms(freshUserPage);
    const wizard = new Wizard(freshUserPage);

    await alarms.gotoUnfiled();
    const id = await alarms.idOf('Standup');

    await alarms.openEdit('Standup');

    // Edit reuses the create wizard, so the form arrives populated and the
    // final control reads "Save changes" rather than "Create alarm".
    await expect(freshUserPage).toHaveURL(new RegExp(`/alarms/${id}/edit$`));
    await wizard.expectStep(wizard.BASICS);

    // The form is populated when the alarm fetch resolves. Editing before
    // then merges with the value that arrives afterwards.
    await wizard.waitForLoadedAlarm('Standup');

    await wizard.fillName('Daily standup');
    await wizard.next();

    await wizard.expectStep(wizard.SCHEDULE);
    await wizard.fillTime('09:45');
    await wizard.next();

    await wizard.expectStep(wizard.REPETITION);
    await wizard.next();

    await wizard.expectStep(wizard.REVIEW);
    await expect(wizard.reviewValue('name')).toHaveText('Daily standup');
    await expect(wizard.submitButton).toHaveText('Save changes');
    await wizard.submit();

    await expect(alarms.row('Daily standup')).toBeVisible();
    // Exact match: "Daily standup" contains "Standup", so a substring
    // assertion that the old name is gone would fail against the new one.
    await expect(alarms.rowNamed('Standup')).toHaveCount(0);

    // Same id, new values -- an "edit" that created a second alarm and left
    // the first behind would satisfy the row assertions above.
    const saved = await api.json<SavedAlarm>(await api.get(`/alarms/${id}`));
    expect(saved).toMatchObject({ name: 'Daily standup', timeOfDay: '09:45' });

    const all = await api.json<{ items: unknown[] }>(await api.get('/alarms'));
    expect(all.items, 'editing should not have created a second alarm').toHaveLength(1);
  });

  test('TC9b: deleting an alarm asks first, and the record goes', async ({ freshUserPage }) => {
    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();
    await api.json(await api.post('/alarms', alarmBody('Coffee', '14:00')));
    await api.json(await api.post('/alarms', alarmBody('Water', '15:00')));

    const alarms = new Alarms(freshUserPage);
    await alarms.gotoUnfiled();
    await expect(alarms.rows).toHaveCount(2);

    const coffeeId = await alarms.idOf('Coffee');

    // Backing out of the confirmation must change nothing.
    await alarms.startDelete('Coffee');
    await expect(alarms.deleteDialog).toBeVisible();
    await freshUserPage.keyboard.press('Escape');
    await expect(alarms.deleteDialog).toBeHidden();
    await expect(alarms.row('Coffee')).toBeVisible();

    await alarms.deleteAlarm('Coffee');

    await expect(alarms.row('Coffee')).toHaveCount(0);
    await expect(alarms.rows).toHaveCount(1);
    await expect(alarms.row('Water')).toBeVisible();

    // Gone from the server, not only from the page.
    const response = await api.get(`/alarms/${coffeeId}`);
    expect(response.status(), 'the deleted alarm should no longer be readable').toBe(404);

    const remaining = await api.json<{ items: Array<{ name: string }> }>(await api.get('/alarms'));
    expect(remaining.items.map((a) => a.name)).toEqual(['Water']);
  });
});
