import { test, expect } from '../../src/fixtures.js';
import type { Page } from '@playwright/test';
import { ApiClient } from '../../src/support/apiClient.js';
import { Alarms } from '../../src/pages/alarms.js';

/**
 * TC4 and TC27 — an alarm firing, and a disabled one not.
 * Requirements R-28, R-32.
 *
 * This is the pair the suite was missing, and TC27 is the single
 * highest-value case in it: it guards DEF-05, where switching an alarm off
 * did not stop it speaking. The server was right throughout — a disabled
 * alarm leaves the upcoming feed immediately — and the entire fault was in
 * the browser, which had armed a timer per occurrence and never disarmed
 * them. No API spec can see that, by construction.
 *
 * Three things have to be controlled for this to be a test rather than a
 * two-minute wait:
 *
 * **Time.** `page.clock` runs the browser's clock, so an alarm due in a
 * minute can be made to arrive now. The clock is installed at the real
 * instant rather than a fictional one, because the occurrence times come
 * from the server and the two have to agree.
 *
 * **Notifications.** Headless Chromium will not raise a real one, and a
 * passing test must not depend on the operating system. `Notification` is
 * replaced with a recorder, which also settles permission — the thing a
 * browser will not grant without a click it believes came from a person.
 *
 * **Speech.** Stubbed for the same reason, and because the assertion that
 * matters in TC27 is that nothing was said at all.
 *
 * What is deliberately NOT stubbed is the scheduler, the upcoming feed, or
 * anything else in the application. The seam is at the browser's own API,
 * one layer below the code under test.
 */

interface Recorded {
  notifications: Array<{ title: string; body: string; tag: string }>;
  spoken: string[];
}

async function recordInsteadOfFiring(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const recorded = { notifications: [], spoken: [] } as unknown as Recorded;
    (window as unknown as { __recorded: Recorded }).__recorded = recorded;

    class RecordingNotification {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, options?: { body?: string; tag?: string }) {
        recorded.notifications.push({
          title,
          body: options?.body ?? '',
          tag: options?.tag ?? '',
        });
      }
      close() {}
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: RecordingNotification,
    });

    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: (utterance: { text: string }) => recorded.spoken.push(utterance.text),
        cancel: () => {},
        getVoices: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  });
}

const recorded = (page: Page) =>
  page.evaluate(() => (window as unknown as { __recorded: Recorded }).__recorded);

/**
 * An alarm due on the next minute boundary at least twenty seconds out.
 *
 * `timeOfDay` has minute granularity, so the occurrence has to land on a
 * boundary. Twenty seconds of margin keeps it from being already past by the
 * time the page has loaded, and the whole window stays well inside the
 * scheduler's two-minute lookahead.
 */
function dueShortly(now: Date) {
  const target = new Date(Math.ceil((now.getTime() + 20_000) / 60_000) * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    at: target,
    timeOfDay: `${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}`,
    startDate: target.toISOString().slice(0, 10),
  };
}

async function turnNotificationsOn(page: Page): Promise<void> {
  await page.goto('/settings');
  const state = page.getByTestId('notification-permission-state');
  await expect(state).toHaveAttribute('data-permission', 'granted');

  const toggle = page.getByTestId('notification-enabled-toggle');
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(state).toHaveAttribute('data-active', 'true');
}

test.describe('an alarm firing @ui @notification', () => {
  test('TC4: an enabled alarm raises a notification naming it, and speaks its message', async ({
    freshUserPage,
  }) => {
    await recordInsteadOfFiring(freshUserPage);

    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();

    const now = new Date();
    await freshUserPage.clock.install({ time: now });

    const due = dueShortly(now);
    await api.json(
      await api.post('/alarms', {
        name: 'Stand up',
        timeOfDay: due.timeOfDay,
        timezone: 'UTC',
        startDate: due.startDate,
        rule: { type: 'daily' },
        speechText: 'Time to stand up and stretch',
      }),
    );

    await turnNotificationsOn(freshUserPage);

    // Let the scheduler see the occurrence and arm its timer before time moves.
    const alarms = new Alarms(freshUserPage);
    await alarms.gotoUnfiled();
    await expect(alarms.row('Stand up')).toBeVisible();

    await freshUserPage.clock.fastForward(130_000);

    await expect
      .poll(async () => (await recorded(freshUserPage)).notifications.length, {
        message: 'the alarm should have raised exactly one notification',
        timeout: 10_000,
      })
      .toBe(1);

    const fired = await recorded(freshUserPage);

    // The title names the alarm, which is the whole point of a notification
    // that arrives while the person is looking at something else.
    expect(fired.notifications[0].title).toBe('Stand up');
    // Unfiled alarms report the bucket they are in, then the local time.
    expect(fired.notifications[0].body).toMatch(/\d{1,2}:\d{2}/);
    expect(fired.spoken, 'the message should have been spoken').toContain(
      'Time to stand up and stretch',
    );
  });

  test('TC27: switching an alarm off stops it firing, and stops it speaking', async ({
    freshUserPage,
  }) => {
    await recordInsteadOfFiring(freshUserPage);

    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();

    const now = new Date();
    await freshUserPage.clock.install({ time: now });

    const due = dueShortly(now);
    await api.json(
      await api.post('/alarms', {
        name: 'Hydrate',
        timeOfDay: due.timeOfDay,
        timezone: 'UTC',
        startDate: due.startDate,
        rule: { type: 'daily' },
        speechText: 'Drink some water',
      }),
    );

    await turnNotificationsOn(freshUserPage);

    const alarms = new Alarms(freshUserPage);
    await alarms.gotoUnfiled();
    await expect(alarms.row('Hydrate')).toBeVisible();

    // The alarm is enabled and inside the lookahead here, so the timer is
    // armed. That ordering is the test: disabling before the page ever saw
    // it would prove nothing, because there would be no timer to disarm.
    // DEF-05 was exactly this — the scheduler only ever added timers.
    const id = await alarms.idOf('Hydrate');
    await alarms.disable('Hydrate');

    await expect(async () => {
      const saved = await api.json<{ enabled: boolean }>(await api.get(`/alarms/${id}`));
      expect(saved.enabled, 'the alarm should be stored as disabled').toBe(false);
    }).toPass({ timeout: 5_000 });

    // And it leaves the feed the scheduler reads, which is the server's half.
    const upcoming = await api.json<{ items: Array<{ alarmId: string }> }>(
      await api.get('/me/upcoming', { withinMinutes: 60 }),
    );
    expect(upcoming.items.map((item) => item.alarmId)).not.toContain(id);

    await freshUserPage.clock.fastForward(130_000);

    // Past the moment it would have fired. Nothing, by either route.
    await freshUserPage.waitForTimeout(1_000);
    const fired = await recorded(freshUserPage);

    expect(fired.notifications, 'a disabled alarm must raise no notification').toEqual([]);
    expect(fired.spoken, 'a disabled alarm must say nothing').toEqual([]);
  });
});
