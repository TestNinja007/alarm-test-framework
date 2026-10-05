import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The alarms table, inside a group or at the root for unfiled ones.
 *
 * Rows carry `data-alarm-id`, which is what makes a UI assertion checkable
 * against the API afterwards: the spec reads the id off the row it clicked and
 * asks the server what it now holds. Driving the interface and verifying
 * through the API is the pattern these specs are built on — the clicks are the
 * test, the API is the oracle.
 */
export class Alarms {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByTestId('alarms-page');
  }

  get table(): Locator {
    return this.page.getByTestId('alarm-table');
  }

  get rows(): Locator {
    return this.page.getByTestId('alarm-row');
  }

  get emptyState(): Locator {
    return this.page.getByTestId('alarm-list-empty');
  }

  get skeleton(): Locator {
    return this.page.getByTestId('alarm-list-skeleton');
  }

  get total(): Locator {
    return this.page.getByTestId('alarm-total');
  }

  get toast(): Locator {
    return this.page.getByTestId('toast-message');
  }

  /**
   * The unfiled alarms.
   *
   * There is no separate route for them: the alarms list is
   * `/folders/:folderId` throughout, and "unfiled" is the segment that stands
   * in for no group at all. Treating the bucket as one more folder rather than
   * a new idea is deliberate in the application, and this mirrors it.
   */
  async gotoUnfiled(): Promise<void> {
    await this.page.goto('/folders/unfiled');
    await this.waitUntilLoaded();
  }

  async gotoGroup(folderId: string): Promise<void> {
    await this.page.goto(`/folders/${folderId}`);
    await this.waitUntilLoaded();
  }

  get listContainer(): Locator {
    return this.page.getByTestId('alarm-list-container');
  }

  /**
   * Waits for the list to have finished loading, rather than racing it.
   *
   * See the note on Dashboard.waitUntilLoaded: A-01's deliberate skeleton
   * delay is announced through `aria-busy`, and waiting on that signal is what
   * makes these specs deterministic at any value of `LIST_DELAY_MS`.
   */
  async waitUntilLoaded(): Promise<void> {
    await expect(this.listContainer).toHaveAttribute('aria-busy', 'false');
  }

  /** The row for an alarm whose name *contains* this text. */
  row(name: string): Locator {
    return this.rows.filter({ hasText: name });
  }

  /**
   * The row for an alarm named exactly this.
   *
   * `row()` matches a substring, which is convenient and occasionally a trap:
   * asserting that "Standup" is gone after renaming it to "Daily standup"
   * fails, because the new name contains the old one. Any assertion that
   * something is *absent* should use this instead.
   */
  rowNamed(name: string): Locator {
    return this.rows.filter({
      has: this.page.getByTestId('alarm-name-cell').getByText(name, { exact: true }),
    });
  }

  /** The alarm's server-side id, read off the row the spec is looking at. */
  async idOf(name: string): Promise<string> {
    const id = await this.row(name).getAttribute('data-alarm-id');
    if (!id) throw new Error(`No data-alarm-id on the row for "${name}"`);
    return id;
  }

  enabledToggle(name: string): Locator {
    return this.row(name).getByTestId('alarm-enabled-toggle');
  }

  /**
   * Switches an alarm off through the interface.
   *
   * The control is a `button role="switch"`, not a checkbox, so Playwright's
   * `uncheck()` refuses it — a switch has no checked property to set, only a
   * click that flips it. That makes the operation unconditional, so the
   * current state is asserted first: without that, calling this on an already
   * disabled alarm would quietly enable it and the spec would fail somewhere
   * else entirely.
   *
   * A-05 updates the row optimistically and then reconciles with the server,
   * so the control reports the new state before the server has agreed. A spec
   * that needs to know what was actually persisted asks the API.
   */
  async disable(name: string): Promise<void> {
    const toggle = this.enabledToggle(name);
    await expect(toggle, `"${name}" should be enabled before switching it off`).toBeChecked();
    await toggle.click();
  }

  async enable(name: string): Promise<void> {
    const toggle = this.enabledToggle(name);
    await expect(toggle, `"${name}" should be disabled before switching it on`).not.toBeChecked();
    await toggle.click();
  }

  async openEdit(name: string): Promise<void> {
    await this.row(name).getByTestId('alarm-edit-link').click();
  }

  async openPreview(name: string): Promise<void> {
    await this.row(name).getByTestId('alarm-preview-button').click();
  }

  get occurrenceRows(): Locator {
    return this.page.getByTestId('occurrence-row');
  }

  // --- Deleting ------------------------------------------------------------

  async startDelete(name: string): Promise<void> {
    await this.row(name).getByTestId('alarm-delete-button').click();
  }

  get deleteDialog(): Locator {
    return this.page.getByTestId('alarm-delete-dialog');
  }

  async confirmDelete(): Promise<void> {
    await this.page.getByTestId('alarm-delete-dialog-confirm-button').click();
    await this.waitUntilLoaded();
  }

  async deleteAlarm(name: string): Promise<void> {
    await this.startDelete(name);
    await this.confirmDelete();
  }

  // --- Searching -----------------------------------------------------------

  /** A-06 debounces this by 300 ms, so assert on the result, never on a wait. */
  async search(term: string): Promise<void> {
    await this.page.getByTestId('alarm-search-input').fill(term);
  }

  get searchResults(): Locator {
    return this.page.getByTestId('search-result-row');
  }

  get searchEmpty(): Locator {
    return this.page.getByTestId('alarm-search-empty');
  }
}
