import { test, expect } from '../../src/fixtures.js';

/**
 * TC30 and TC53 — deleting things through the interface's own guard.
 * Requirements R-10, R-34.
 *
 * What is left here is what the API can answer for itself: that an
 * unconfirmed delete is refused and says how many alarms would go, and that
 * deleting one alarm leaves its group and siblings alone.
 *
 * TC51 and TC52 used to live here and now live in `database/`. Both ask
 * whether the rows are really gone or merely unreachable, which is a question
 * for SQL - an API can report rows gone simply by filtering on a parent that
 * no longer exists. See CLAUDE.md on the two stacks.
 *
 * The guard matters as much as the deletion. R-10 refuses an unconfirmed
 * delete and reports how many alarms would go with the group — a number
 * somebody reads before agreeing to lose them.
 */

const alarmIn = (folderId: string, name: string, timeOfDay: string) => ({
  name,
  timeOfDay,
  timezone: 'UTC',
  startDate: '2027-03-01',
  rule: { type: 'daily' },
  folderId,
});

interface Folder {
  id: string;
}

test.describe('deleting things @destructive', () => {
  test('TC30: deleting a group that holds alarms is refused without confirmation', async ({
    freshApi,
  }) => {
    const folder = await freshApi.json<Folder>(
      await freshApi.post('/folders', { name: `Doomed ${Date.now()}` }),
    );
    await freshApi.json(await freshApi.post('/alarms', alarmIn(folder.id, 'One', '07:05')));
    await freshApi.json(await freshApi.post('/alarms', alarmIn(folder.id, 'Two', '07:10')));

    const refused = await freshApi.delete(`/folders/${folder.id}`);
    expect(refused.status(), 'an unconfirmed delete should be refused').toBe(409);

    /*
     * The count is the point. It is the only thing telling the person how
     * much they are about to lose, so a confirmation that omits it — or gets
     * it wrong — is a confirmation that cannot be given meaningfully.
     */
    const body = (await refused.json()) as { error: { details?: { alarmCount?: number } } };
    expect(
      body.error.details?.alarmCount,
      'the refusal should say how many alarms would go',
    ).toBe(2);

    // And nothing was destroyed on the way to saying no.
    const still = await freshApi.json<{ items: Folder[] }>(await freshApi.get('/folders'));
    expect(still.items.map((f) => f.id)).toContain(folder.id);
    const alarms = await freshApi.json<{ total: number }>(
      await freshApi.get(`/alarms`, { folderId: folder.id }),
    );
    expect(alarms.total).toBe(2);
  });

  test('TC53: deleting an alarm leaves its group and the group’s other alarms intact', async ({
    freshApi,
  }) => {
    const folder = await freshApi.json<Folder>(
      await freshApi.post('/folders', { name: `Keep ${Date.now()}` }),
    );
    const doomed = await freshApi.json<{ id: string }>(
      await freshApi.post('/alarms', alarmIn(folder.id, 'Goes', '06:05')),
    );
    const kept = await freshApi.json<{ id: string }>(
      await freshApi.post('/alarms', alarmIn(folder.id, 'Stays', '06:10')),
    );

    const deleted = await freshApi.delete(`/alarms/${doomed.id}`);
    expect(deleted.ok(), 'deleting one alarm should succeed').toBeTruthy();

    expect((await freshApi.get(`/alarms/${doomed.id}`)).status()).toBe(404);
    expect((await freshApi.get(`/alarms/${kept.id}`)).ok(), 'the sibling survives').toBeTruthy();

    const folders = await freshApi.json<{ items: Folder[] }>(await freshApi.get('/folders'));
    expect(folders.items.map((f) => f.id), 'the group survives its alarm').toContain(folder.id);
  });
});
