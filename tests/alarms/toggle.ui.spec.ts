import { test, expect } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';
import { Alarms } from '../../src/pages/alarms.js';

/**
 * TC5 — the alarm disable button, through the interface. Requirement R-28.
 *
 * This is the case DEF-05 came from, and the reason it belongs in a browser
 * rather than against the API. The server was right the whole time: a disabled
 * alarm left the upcoming feed immediately. The browser had already armed a
 * timer for every occurrence inside its two-minute lookahead and nothing ever
 * disarmed them, so switching an alarm off left it speaking for another two
 * minutes — and, because a queued utterance outlives the page that queued it,
 * kept talking after the tab was closed.
 *
 * No API spec can see that. This one covers the first half of R-28: that the
 * control reflects the change and the change is actually stored. The second
 * half — that nothing fires afterwards — is TC27, which needs a controlled
 * browser clock and a stubbed speech synthesiser.
 *
 * The alarm is created through the API on purpose. The subject here is the
 * toggle, so a red test should mean the toggle is broken, not the wizard.
 */

const alarmBody = (name: string) => ({
  name,
  timeOfDay: '09:00',
  timezone: 'UTC',
  startDate: '2027-01-04',
  rule: { type: 'daily' },
});

test.describe('switching an alarm off @ui', () => {
  test('TC5: switching an alarm off is stored, and switching it back on restores it', async ({
    freshUserPage,
  }) => {
    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();
    await api.json(await api.post('/alarms', alarmBody('Hydrate')));

    const alarms = new Alarms(freshUserPage);
    await alarms.gotoUnfiled();

    await expect(alarms.row('Hydrate')).toBeVisible();
    await expect(alarms.enabledToggle('Hydrate')).toBeChecked();

    const id = await alarms.idOf('Hydrate');

    await alarms.disable('Hydrate');
    await expect(alarms.enabledToggle('Hydrate')).not.toBeChecked();

    // A-05 updates the row optimistically and reconciles afterwards, so the
    // control showing "off" proves only that the browser believes it. What
    // was persisted is a separate question, and the one that matters.
    await expect(async () => {
      const saved = await api.json<{ enabled: boolean }>(await api.get(`/alarms/${id}`));
      expect(saved.enabled, 'the server should have stored the alarm as disabled').toBe(false);
    }).toPass({ timeout: 5_000 });

    // R-28 also means a disabled alarm stops being scheduled at all, which is
    // observable without a clock: it leaves the upcoming feed.
    const upcoming = await api.json<{ items: Array<{ alarmId: string }> }>(
      await api.get('/me/upcoming', { withinMinutes: 60 }),
    );
    expect(
      upcoming.items.map((item) => item.alarmId),
      'a disabled alarm should not be in the upcoming feed',
    ).not.toContain(id);

    // Reversible, which is the half that makes it a switch and not a delete.
    await alarms.enable('Hydrate');
    await expect(alarms.enabledToggle('Hydrate')).toBeChecked();

    await expect(async () => {
      const saved = await api.json<{ enabled: boolean }>(await api.get(`/alarms/${id}`));
      expect(saved.enabled, 'the server should have stored the alarm as enabled again').toBe(true);
    }).toPass({ timeout: 5_000 });
  });

  test('TC5b: the change survives a reload', async ({ freshUserPage }) => {
    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();
    await api.json(await api.post('/alarms', alarmBody('Walk')));

    const alarms = new Alarms(freshUserPage);
    await alarms.gotoUnfiled();
    await alarms.disable('Walk');
    await expect(alarms.enabledToggle('Walk')).not.toBeChecked();

    // An optimistic update that was never persisted looks identical to one
    // that was, until the page is loaded again from nothing.
    await freshUserPage.reload();

    await expect(alarms.enabledToggle('Walk')).not.toBeChecked();
  });
});
