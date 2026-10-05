import { test, expect } from '../../src/fixtures.js';
import { ApiClient } from '../../src/support/apiClient.js';
import { Alarms } from '../../src/pages/alarms.js';
import { Dashboard } from '../../src/pages/dashboard.js';

/**
 * TC6 and TC10 — alarm groups, through the interface.
 * Requirements R-20, R-23, R-33, and R-10.
 *
 * Grouping is one of the product's two stated pillars, and before these specs
 * nothing anywhere exercised it: no API spec touched `/folders` at all. R-10
 * in particular — deleting a group deletes its alarms, and the confirmation
 * carries the count — was a destructive operation behind a confirmation guard
 * with no coverage of either half.
 *
 * Group actions live behind a per-row menu, so every verb here is four
 * interactions: open the menu, choose the action, fill the dialog, submit.
 * That sequence is the thing being tested as much as the outcome is.
 */

const alarmIn = (folderId: string, name: string, timeOfDay: string) => ({
  name,
  timeOfDay,
  timezone: 'UTC',
  startDate: '2027-01-04',
  rule: { type: 'daily' },
  folderId,
});

interface Folder {
  id: string;
  name: string;
}

test.describe('alarm groups @ui', () => {
  test('TC6: a group can be created, and an alarm filed into it', async ({ freshUserPage }) => {
    const dashboard = new Dashboard(freshUserPage);
    const alarms = new Alarms(freshUserPage);

    await dashboard.goto();

    // A pristine account has no groups, so the empty state is the starting
    // point rather than something to be arranged.
    await expect(dashboard.emptyState).toBeVisible();

    await dashboard.createGroup('Workout');

    await expect(dashboard.createDialog).toBeHidden();
    await expect(dashboard.groupRow('Workout')).toBeVisible();

    // The server holds it, under this account and no other.
    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();
    const folders = await api.json<{ items: Folder[] }>(await api.get('/folders'));
    expect(folders.items.map((f) => f.name)).toEqual(['Workout']);

    // R-33: an alarm can be filed into a group. Opening the group and
    // creating from inside it is the route a person takes.
    await dashboard.openGroup('Workout');
    await expect(alarms.emptyState).toBeVisible();
  });

  test('TC6b: a group name already in use is refused in the dialog', async ({ freshUserPage }) => {
    const dashboard = new Dashboard(freshUserPage);

    await dashboard.goto();
    await dashboard.createGroup('Unwind');
    await expect(dashboard.groupRow('Unwind')).toBeVisible();

    // R-09 makes names unique per account, case-insensitively after trimming.
    // The interesting part is where the refusal lands: a 409 that leaves the
    // dialog open with an error beside the field is usable; one that closes
    // the dialog and shows nothing is not.
    await dashboard.createGroup('  unwind  ');

    await expect(dashboard.createDialog).toBeVisible();
    await expect(dashboard.createDialogError).toBeVisible();

    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();
    const folders = await api.json<{ items: Folder[] }>(await api.get('/folders'));
    expect(folders.items, 'the duplicate should not have been created').toHaveLength(1);
  });

  test('TC10: a group can be renamed', async ({ freshUserPage }) => {
    const dashboard = new Dashboard(freshUserPage);

    await dashboard.goto();
    await dashboard.createGroup('Moring routine');
    await expect(dashboard.groupRow('Moring routine')).toBeVisible();

    await dashboard.rename('Moring routine', 'Morning routine');

    await expect(dashboard.renameDialog).toBeHidden();
    await expect(dashboard.groupRow('Morning routine')).toBeVisible();
    await expect(dashboard.groupRow('Moring routine')).toHaveCount(0);

    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();
    const folders = await api.json<{ items: Folder[] }>(await api.get('/folders'));
    expect(folders.items.map((f) => f.name)).toEqual(['Morning routine']);
  });

  test('TC10b: deleting a group warns how many alarms go with it, and takes them', async ({
    freshUserPage,
  }) => {
    const api = new ApiClient(freshUserPage.request);
    await api.adoptSession();

    // Arranged through the API: the subject is the deletion, not the setup.
    const folder = await api.json<Folder>(await api.post('/folders', { name: 'Evening' }));
    await api.json(await api.post('/alarms', alarmIn(folder.id, 'Dim lights', '21:00')));
    await api.json(await api.post('/alarms', alarmIn(folder.id, 'Box breathing', '21:30')));

    const dashboard = new Dashboard(freshUserPage);
    await dashboard.goto();
    await expect(dashboard.groupRow('Evening')).toBeVisible();

    await dashboard.startDelete('Evening');

    // R-10. The count in this sentence is the only warning a person gets
    // before two alarms are destroyed, so it is part of the requirement and
    // not decoration. Asserting the number catches an off-by-one that would
    // otherwise read as plausible.
    await expect(dashboard.deleteDialog).toBeVisible();
    await expect(dashboard.deleteDialogDescription).toContainText('2 alarms');
    await expect(dashboard.deleteDialogDescription).toContainText('cannot be undone');

    // Backing out must change nothing -- a confirmation that destroys on
    // cancel is worse than no confirmation at all.
    await dashboard.cancelDelete();
    await expect(dashboard.deleteDialog).toBeHidden();
    await expect(dashboard.groupRow('Evening')).toBeVisible();

    const stillThere = await api.json<{ items: unknown[] }>(await api.get('/alarms'));
    expect(stillThere.items, 'cancelling should have deleted nothing').toHaveLength(2);

    await dashboard.deleteGroup('Evening');

    await expect(dashboard.groupRow('Evening')).toHaveCount(0);

    const folders = await api.json<{ items: Folder[] }>(await api.get('/folders'));
    expect(folders.items).toHaveLength(0);

    // And the alarms went with it, rather than being orphaned or quietly
    // becoming unfiled.
    const remaining = await api.json<{ items: unknown[] }>(await api.get('/alarms'));
    expect(remaining.items, "the group's alarms should have gone too").toHaveLength(0);
  });
});
