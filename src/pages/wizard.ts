import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The four-step create wizard, driven the way a person drives it.
 *
 * The point of a page object here is not to shorten the specs. It is that a
 * spec should read as the case it implements — "name it, schedule it, submit
 * it" — while the knowledge of which field lives on which step, and that the
 * step must be advanced before the next field exists, lives in one place. The
 * wizard has four steps and gates each one on the fields it needs (A-03), so
 * a spec that reached for a timezone input while still on Basics would fail
 * for a reason that has nothing to do with what it was testing.
 *
 * Defaults are deliberately not filled in. The form arrives with 07:00,
 * America/Toronto and today's date already set, so a spec that supplies none
 * of them is exercising the real default path rather than a contrived one.
 */
export class Wizard {
  constructor(private readonly page: Page) {}

  /** Step 1 of 4. */
  readonly BASICS = 1;
  /** Step 2 of 4. */
  readonly SCHEDULE = 2;
  /** Step 3 of 4. */
  readonly REPETITION = 3;
  /** Step 4 of 4. */
  readonly REVIEW = 4;

  get root(): Locator {
    return this.page.getByTestId('wizard-page');
  }

  get nextButton(): Locator {
    return this.page.getByTestId('wizard-next-button');
  }

  get backButton(): Locator {
    return this.page.getByTestId('wizard-back-button');
  }

  get submitButton(): Locator {
    return this.page.getByTestId('wizard-submit-button');
  }

  get error(): Locator {
    return this.page.getByTestId('wizard-error');
  }

  /** The step markers, so a spec can assert which step it is on. */
  get steps(): Locator {
    return this.page.getByTestId('wizard-step');
  }

  fieldError(field: string): Locator {
    return this.page.getByTestId(`alarm-${field}-error`);
  }

  reviewValue(of: string): Locator {
    return this.page.getByTestId(`review-${of}`);
  }

  /** Waits until the given step is the current one. */
  async expectStep(step: number): Promise<void> {
    await expect(
      this.steps.nth(step - 1),
      `the wizard should be on step ${step}`,
    ).toHaveAttribute('aria-current', 'step');
  }

  async next(): Promise<void> {
    await this.nextButton.click();
  }

  async back(): Promise<void> {
    await this.backButton.click();
  }

  // --- Step 1: Basics -----------------------------------------------------

  get nameInput(): Locator {
    return this.page.getByTestId('alarm-name-input');
  }

  /**
   * Waits for an edit to have loaded the alarm it is editing.
   *
   * In edit mode the form arrives empty and is populated when the alarm
   * fetch resolves. Typing into it before then does not merely get
   * overwritten — it produced `StandupDaily standup`, the old value and the
   * new one concatenated, because `fill()` had already set React's state when
   * hydration arrived. So the wait is not politeness; without it the spec
   * asserts against a value neither the test nor a user ever asked for.
   */
  async waitForLoadedAlarm(name: string): Promise<void> {
    await expect(this.nameInput, 'the edit form should have loaded the alarm').toHaveValue(name);
  }

  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }

  async chooseGroup(name: string): Promise<void> {
    await this.page.getByTestId('alarm-folder-select').selectOption({ label: name });
  }

  async fillSpokenMessage(text: string): Promise<void> {
    await this.page.getByTestId('alarm-speech-text-input').fill(text);
  }

  async checkSelfDestruct(): Promise<void> {
    await this.page.getByTestId('alarm-self-destruct-checkbox').check();
  }

  // --- Step 2: Schedule ---------------------------------------------------

  async fillTime(timeOfDay: string): Promise<void> {
    await this.page.getByTestId('alarm-time-input').fill(timeOfDay);
  }

  async fillTimezone(timezone: string): Promise<void> {
    await this.page.getByTestId('alarm-timezone-input').fill(timezone);
  }

  async fillStartDate(date: string): Promise<void> {
    await this.page.getByTestId('alarm-start-date-input').fill(date);
  }

  async fillEndDate(date: string): Promise<void> {
    await this.page.getByTestId('alarm-end-date-input').fill(date);
  }

  async fillEndAfterOccurrences(count: string): Promise<void> {
    await this.page.getByTestId('alarm-end-count-input').fill(count);
  }

  // --- Step 3: Repetition -------------------------------------------------

  async chooseRule(value: string): Promise<void> {
    await this.page.getByTestId('alarm-rule-type-select').selectOption(value);
  }

  // --- Step 4: Review -----------------------------------------------------

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /**
   * The shortest route from an empty wizard to a saved alarm: a name, then the
   * defaults the form already carries.
   *
   * Used by specs whose subject is what happens *after* an alarm exists. A
   * spec about the wizard itself should drive the steps directly, so that a
   * failure names the step it happened on.
   */
  async createWithDefaults(name: string): Promise<void> {
    await this.expectStep(this.BASICS);
    await this.fillName(name);
    await this.next();

    await this.expectStep(this.SCHEDULE);
    await this.next();

    await this.expectStep(this.REPETITION);
    await this.next();

    await this.expectStep(this.REVIEW);
    await this.submit();
  }
}
