import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The alarm dashboard: the groups, the loose alarms, and the ways in.
 *
 * Group actions sit behind a per-row menu rather than a row of buttons, so
 * renaming means open the menu, choose Rename, type into a dialog, submit.
 * Four interactions for one verb. Keeping that sequence here means a spec says
 * `rename('Workout', 'Morning')` and a change to the menu breaks one method
 * rather than every spec that renames anything.
 */
export class Dashboard {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByTestId('folders-page');
  }

  get groupRows(): Locator {
    return this.page.getByTestId('folder-row');
  }

  get emptyState(): Locator {
    return this.page.getByTestId('folder-list-empty');
  }

  get looseAlarmRows(): Locator {
    return this.page.getByTestId('loose-alarm-row');
  }

  get toast(): Locator {
    return this.page.getByTestId('toast-message');
  }

  get groupListContainer(): Locator {
    return this.page.getByTestId('folder-list-container');
  }

  /**
   * Waits for the list to have finished loading, rather than racing it.
   *
   * A-01 delays the list by `LIST_DELAY_MS` — 600 ms by default — and shows a
   * skeleton inside an `aria-busy` container while it waits. That delay is a
   * testability feature and not latency, but a spec that asserts on content
   * without waiting for the container to stop being busy is racing it, and a
   * test doing several loads can spend its whole assertion window on them.
   * This was found the honest way: the first version of these specs passed at
   * two workers and failed intermittently at four.
   *
   * Waiting on the application's own readiness signal rather than on a sleep
   * is what makes the specs deterministic at any delay — including 0, which is
   * how the load tests run it.
   */
  async waitUntilLoaded(): Promise<void> {
    await expect(this.groupListContainer).toHaveAttribute('aria-busy', 'false');
  }

  async goto(): Promise<void> {
    await this.page.goto('/folders');
    await this.waitUntilLoaded();
  }

  /** The row for a named group, found by its visible name. */
  groupRow(name: string): Locator {
    return this.groupRows.filter({ hasText: name });
  }

  /** The wizard, entered with no group chosen — the DEF-10 route. */
  async newUnfiledAlarm(): Promise<void> {
    await this.page.getByTestId('alarm-create-unfiled-link').click();
  }

  async openGroup(name: string): Promise<void> {
    await this.groupRow(name).getByTestId('folder-link').click();
  }

  // --- Creating ------------------------------------------------------------

  async createGroup(name: string): Promise<void> {
    await this.page.getByTestId('folder-create-open-button').click();
    await this.page.getByTestId('folder-create-dialog-input').fill(name);
    await this.page.getByTestId('folder-create-dialog-submit-button').click();
    await this.waitUntilLoaded();
  }

  get createDialog(): Locator {
    return this.page.getByTestId('folder-create-dialog');
  }

  get createDialogError(): Locator {
    return this.page.getByTestId('folder-create-dialog-error');
  }

  // --- Renaming ------------------------------------------------------------

  /** Opens the row menu for a group and picks an action from it. */
  private async chooseAction(group: string, action: 'rename' | 'delete'): Promise<void> {
    await this.groupRow(group).getByTestId('folder-actions-button').click();
    await this.page.getByTestId(`folder-${action}-button`).click();
  }

  async rename(group: string, to: string): Promise<void> {
    await this.chooseAction(group, 'rename');
    await this.page.getByTestId('folder-rename-dialog-input').fill(to);
    await this.page.getByTestId('folder-rename-dialog-submit-button').click();
    await this.waitUntilLoaded();
  }

  get renameDialog(): Locator {
    return this.page.getByTestId('folder-rename-dialog');
  }

  // --- Deleting ------------------------------------------------------------

  /** Opens the delete confirmation without confirming it. */
  async startDelete(group: string): Promise<void> {
    await this.chooseAction(group, 'delete');
  }

  get deleteDialog(): Locator {
    return this.page.getByTestId('folder-delete-dialog');
  }

  /**
   * What the confirmation says before anything is destroyed.
   *
   * R-10 makes deleting a group delete its alarms, so the count in this
   * sentence is the only warning a person gets. Asserting it is the point of
   * a destructive-path case, not decoration.
   */
  get deleteDialogDescription(): Locator {
    return this.page.getByTestId('folder-delete-dialog-description');
  }

  async confirmDelete(): Promise<void> {
    await this.page.getByTestId('folder-delete-dialog-confirm-button').click();
    await this.waitUntilLoaded();
  }

  async cancelDelete(): Promise<void> {
    await this.page.getByTestId('folder-delete-dialog-cancel-button').click();
  }

  async deleteGroup(group: string): Promise<void> {
    await this.startDelete(group);
    await this.confirmDelete();
  }
}
