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
 * An alarm whose next occurrence is 35 to 95 seconds away in real time.
 *
 * `timeOfDay` has minute granularity, so the occurrence lands on a boundary.
 * Within-day repetition would remove the arithmetic entirely, but it is gated
 * to paid tiers and a throwaway account is basic.
 *
 * The margin is not the interesting part — the ORDER the caller uses is.
 * `page.clock` freezes the browser, but the upcoming feed is computed by the
 * server from the real instant, so an occurrence that passes while the page is
 * still loading has already left the feed and no timer is ever armed. The
 * first version of this created the alarm first and failed about one run in
 * five. The alarm is now created last, moments before the feed is read.
 */
function dueShortly() {
  const target = new Date(Math.ceil((Date.now() + 35_000) / 60_000) * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    timeOfDay: `${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}`,
    startDate: target.toISOString().slice(0, 10),
  };
}

function alarmDueShortly(name: string, speechText: string) {
  const due = dueShortly();
  return {
    name,
    timeOfDay: due.timeOfDay,
    timezone: 'UTC',
    startDate: due.startDate,
    rule: { type: 'daily' },
    speechText,
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

    await freshUserPage.clock.install({ time: new Date() });
    await turnNotificationsOn(freshUserPage);

    // Created last, so the gap between the occurrence existing and the feed
    // being read is one navigation rather than a page load and a toggle.
    await api.json(
      await api.post('/alarms', alarmDueShortly('Stand up', 'Time to stand up and stretch')),
    );

    const alarms = new Alarms(freshUserPage);
    await alarms.gotoUnfiled();
    await expect(alarms.row('Stand up')).toBeVisible();

    // The row being on screen says the alarm exists, not that the scheduler
    // has armed anything for it. Fast-forwarding before it has produces no
    // notification and a failure that reads like a broken feature.
    await expect(
      freshUserPage.getByTestId('app-topbar'),
      'the scheduler should have armed a timer before time moves',
    ).toHaveAttribute('data-armed-alarms', '1');

    await freshUserPage.clock.fastForward(130_000);

    await expect
      .poll(async () => (await recorded(freshUserPage)).notifications.length, {
        message: 'the alarm should have raised a notification',
        timeout: 10_000,
      })
      .toBe(1);

    const fired = await recorded(freshUserPage);

    const [notification] = fired.notifications;
    if (!notification) throw new Error('the poll said there was one, and there was not');

    // The title names the alarm, which is the whole point of a notification
    // that arrives while the person is looking at something else.
    expect(notification.title).toBe('Stand up');
    // Unfiled alarms report the bucket they are in, then the local time.
    expect(notification.body).toMatch(/\d{1,2}:\d{2}/);
    /*
     * Polled, not read once. The scheduler fires speech without awaiting it,
     * on purpose -- "the notification must appear at the instant the alarm is
     * due, not after a round trip for audio" -- so the words arrive a tick
     * after the notification does. Reading immediately caught an empty array
     * about one run in four, which looked like the message was never spoken.
     */
    await expect
      .poll(async () => (await recorded(freshUserPage)).spoken, {
        message: 'the message should have been spoken',
        timeout: 10_000,
      })
      .toContain('Time to stand up and stretch');
  });

  test('TC27: switching an alarm off stops it firing, and stops it speaking', async ({
    freshUserPage,
  }) => {
    await recordInsteadOfFiring(freshUserPage);

    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();

    await freshUserPage.clock.install({ time: new Date() });
    await turnNotificationsOn(freshUserPage);

    await api.json(await api.post('/alarms', alarmDueShortly('Hydrate', 'Drink some water')));

    const alarms = new Alarms(freshUserPage);
    await alarms.gotoUnfiled();
    await expect(alarms.row('Hydrate')).toBeVisible();

    // The alarm is enabled and inside the lookahead here, so the timer is
    // armed. That ordering is the test: disabling before the page ever saw
    // it would prove nothing, because there would be no timer to disarm.
    // DEF-05 was exactly this — the scheduler only ever added timers.
    const id = await alarms.idOf('Hydrate');

    /*
     * The timer is armed BEFORE the alarm is switched off. Without this the
     * rest of the test is vacuous: an assertion that nothing fired passes
     * just as well when nothing was ever scheduled, and the defect being
     * guarded against is specifically a timer that outlives its alarm.
     */
    await expect(
      freshUserPage.getByTestId('app-topbar'),
      'the scheduler should have armed a timer for the occurrence',
    ).toHaveAttribute('data-armed-alarms', '1');

    /*
     * The scheduler disarms when it receives a feed the alarm has left, so the
     * refetch the toggle triggers is what has to be waited for -- not the
     * server's opinion of it. Asking the API whether the alarm is disabled
     * proves the write landed and says nothing about whether this browser has
     * heard; fast-forwarding before it has leaves the original timer armed and
     * the alarm fires, which is how this spec failed one run in four.
     *
     * The waiter is armed before the click, or the response can arrive first.
     */
    const feedAfterDisable = freshUserPage.waitForResponse(
      (response) =>
        response.url().includes('/me/upcoming') && response.request().method() === 'GET',
    );

    await alarms.disable('Hydrate');

    const feed = (await (await feedAfterDisable).json()) as { items: Array<{ alarmId: string }> };
    expect(
      feed.items.map((item) => item.alarmId),
      'the browser should have been told the alarm is no longer coming',
    ).not.toContain(id);

    /*
     * And has acted on it. The response arriving is not the same as the
     * scheduler having reconciled -- React has to render and run the effect
     * first, and fast-forwarding in between leaves the original timer armed.
     * The topbar reports how many timers this browser holds, which is the
     * only signal for the thing TC27 is actually about.
     */
    await expect(
      freshUserPage.getByTestId('app-topbar'),
      'the scheduler should have disarmed its timer',
    ).toHaveAttribute('data-armed-alarms', '0');

    // The server's half, for completeness: it is stored, not merely hidden.
    const saved = await api.json<{ enabled: boolean }>(await api.get(`/alarms/${id}`));
    expect(saved.enabled, 'the alarm should be stored as disabled').toBe(false);

    await freshUserPage.clock.fastForward(130_000);

    // Past the moment it would have fired. Nothing, by either route.
    await freshUserPage.waitForTimeout(1_000);
    const fired = await recorded(freshUserPage);

    expect(fired.notifications, 'a disabled alarm must raise no notification').toEqual([]);
    expect(fired.spoken, 'a disabled alarm must say nothing').toEqual([]);
  });
});
