import { test, expect, describeWithDatabase } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';
import { countRows } from '../../src/support/db.js';
import { env } from '../../src/support/env.js';
import { request as playwrightRequest } from '@playwright/test';

/**
 * TC30, TC51, TC52 and TC53 — the destructive set.
 * Requirements R-10, R-19, R-34.
 *
 * Deletion is the operation with no second chance, and the one where a test
 * that only asks the API what it can see is not enough: a cascade that
 * removes a row from one table and orphans it in another looks identical
 * through the interface, right up until a foreign key or a report finds it
 * months later. Three of these four read the database afterwards for that
 * reason.
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

describeWithDatabase('deleting things, checked in the database @destructive @db', () => {
  test('TC51: deleting a group deletes its alarms rather than orphaning them', async ({
    freshApi,
  }) => {
    const folder = await freshApi.json<Folder>(
      await freshApi.post('/folders', { name: `Cascade ${Date.now()}` }),
    );
    await freshApi.json(await freshApi.post('/alarms', alarmIn(folder.id, 'First', '05:05')));
    await freshApi.json(await freshApi.post('/alarms', alarmIn(folder.id, 'Second', '05:10')));

    expect(await countRows('alarms', 'folder_id = $1', [folder.id])).toBe(2);

    const deleted = await freshApi.delete(`/folders/${folder.id}?confirm=true`);
    expect(deleted.ok(), 'a confirmed delete should succeed').toBeTruthy();

    const folders = await freshApi.json<{ items: Folder[] }>(await freshApi.get('/folders'));
    expect(folders.items.map((f) => f.id)).not.toContain(folder.id);

    /*
     * The API could report them gone simply by filtering on a group that no
     * longer exists. This is the question the API cannot answer: are the rows
     * actually gone, or are they still there pointing at nothing.
     */
    expect(
      await countRows('alarms', 'folder_id = $1', [folder.id]),
      'no alarm should still reference the deleted group',
    ).toBe(0);
  });

  test('TC52: deleting an account removes everything it owned', async ({ freshUser }) => {
    const context = await playwrightRequest.newContext({ baseURL: env.baseUrl });
    const client = new ApiClient(context);
    await client.signIn(freshUser.email, freshUser.password);

    const me = await client.json<{ user: { id: string } }>(await client.get('/auth/me'));
    const userId = me.user.id;

    const folder = await client.json<Folder>(await client.post('/folders', { name: 'Everything' }));
    await client.json(await client.post('/alarms', alarmIn(folder.id, 'Owned', '04:05')));
    await client.json(
      await client.post('/alarms', {
        name: 'Unfiled and owned',
        timeOfDay: '04:10',
        timezone: 'UTC',
        startDate: '2027-03-01',
        rule: { type: 'daily' },
      }),
    );

    expect(await countRows('folders', 'user_id = $1', [userId])).toBe(1);
    expect(await countRows('alarms', 'user_id = $1', [userId])).toBe(2);

    const deleted = await client.delete('/me?confirm=true', { password: freshUser.password });
    expect(
      deleted.ok(),
      `deleting the account should succeed — ${deleted.status()} ${await deleted.text()}`,
    ).toBeTruthy();

    await context.dispose();

    // It cannot sign in again.
    const after = await playwrightRequest.newContext({ baseURL: env.baseUrl });
    const stale = new ApiClient(after);
    const signIn = await stale.signIn(freshUser.email, freshUser.password);
    expect(signIn.status(), 'a deleted account should not sign in').toBe(401);
    await after.dispose();

    // And it owns nothing, in either table.
    expect(await countRows('folders', 'user_id = $1', [userId]), 'no groups remain').toBe(0);
    expect(await countRows('alarms', 'user_id = $1', [userId]), 'no alarms remain').toBe(0);
  });
});
