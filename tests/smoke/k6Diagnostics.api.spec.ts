import { test, expect } from '@playwright/test';
// @ts-expect-error - a k6 helper, plain JS with no types, imported here only
// because its interesting half is pure and worth testing without k6.
import { classify, describe, SLOW_MS } from '../../k6/lib/diagnose.js';

/**
 * The DEF-08 phase classifier.
 *
 * Not a product test. k6 is not installed on this machine and a load run
 * cannot be made from here, so the thing that CAN be verified is the logic
 * that will interpret the next run - and verifying it now is the difference
 * between instrumentation and a hopeful comment.
 *
 * It runs under Playwright because that is the runner this repository has.
 * It needs no browser and no application, which is why it is tagged @smoke
 * alongside the framework's other checks on itself.
 *
 * The case that matters is the first one: DEF-08's own numbers, asserting
 * that the classifier would name the phase the application cannot account
 * for. If this ever starts reporting `waiting`, the defect is somewhere
 * entirely different from where the evidence currently points.
 */

interface Timings {
  blocked?: number;
  connecting?: number;
  tls_handshaking?: number;
  sending?: number;
  waiting?: number;
  receiving?: number;
  duration?: number;
}

const classifyT = classify as (t: Timings) => {
  dominant: string;
  share: number;
  serverAccountable: boolean;
  total: number;
  phases: Record<string, number>;
};

test.describe('k6 phase classifier @smoke', () => {
  test("DEF-08's signature is named as time the application never saw", () => {
    /*
     * The real numbers from the entry: the slow responses clustered at
     * exactly 10,070 ms while the application logged about 31 ms for the
     * same requests and never once logged between one and five seconds.
     */
    const verdict = classifyT({ blocked: 10_070, waiting: 31, duration: 31 });

    expect(verdict.dominant).toBe('blocked');
    expect(verdict.serverAccountable, 'blocked time is before the server sees it').toBe(false);
    expect(verdict.share).toBeGreaterThan(0.95);

    // And the discrepancy that made this hard to see at all: duration
    // excludes blocked, so the request reports 31 ms and looks fast.
    expect(verdict.total).toBeGreaterThan(10_000);
  });

  test('a genuinely slow server is attributed to the server', () => {
    // The opposite finding, which must not be reported as a network problem.
    const verdict = classifyT({ blocked: 1, waiting: 8_000, duration: 8_001 });

    expect(verdict.dominant).toBe('waiting');
    expect(verdict.serverAccountable, 'waiting is the server thinking').toBe(true);
  });

  test('a stalled TCP handshake is distinguished from a stalled queue', () => {
    const verdict = classifyT({ blocked: 2, connecting: 10_000, waiting: 5, duration: 10_005 });

    expect(verdict.dominant).toBe('connecting');
    expect(verdict.serverAccountable).toBe(false);
  });

  test('TLS time against plain http is surfaced rather than folded away', () => {
    /*
     * Should always be zero here - the target is http. It is kept as its own
     * phase because this machine's TLS interception has already broken two
     * package managers in this project, and a non-zero value would be its
     * own finding rather than noise to average out.
     */
    const verdict = classifyT({ tls_handshaking: 9_000, waiting: 10, duration: 9_010 });

    expect(verdict.dominant).toBe('tls_handshaking');
    expect(verdict.serverAccountable).toBe(false);
  });

  test('a fast request is unremarkable and not flagged', () => {
    const verdict = classifyT({ blocked: 1, connecting: 0, waiting: 40, duration: 41 });

    expect(verdict.total).toBeLessThan(SLOW_MS as number);
    expect(verdict.serverAccountable).toBe(true);
  });

  test('a response with no timings at all does not divide by zero', () => {
    // status 0 with every phase empty is the "connection never completed"
    // case the entry notes, and it must not throw while being described.
    const verdict = classifyT({});

    expect(verdict.total).toBe(0);
    expect(verdict.share).toBe(0);
    expect(Number.isNaN(verdict.share)).toBe(false);
  });

  test('the logged line carries what an investigator needs', () => {
    const line = (describe as (name: string, response: unknown) => string)('GET /alarms', {
      status: 0,
      error: 'request timeout',
      error_code: 1050,
      body: null,
      timings: { blocked: 10_070, waiting: 0, duration: 0 },
    });

    // error_code is the single most localising field k6 offers and was never
    // recorded; status 0 alone cannot tell a timeout from a refused dial.
    expect(line).toContain('error_code=1050');
    expect(line).toContain('status=0');
    expect(line).toContain('dominant=blocked');
    expect(line).toContain('server_accountable=false');
    expect(line).toContain('blocked=10070ms');
  });
});
