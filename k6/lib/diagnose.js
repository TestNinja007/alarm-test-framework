/**
 * What a failing or slow request actually spent its time on.
 *
 * DEF-08 is open because a client-side duration cannot distinguish "the
 * application is slow" from "something between the client and the application
 * is slow". The server's own log already answered that negatively - across
 * 6,959 responses it never once took between one and five seconds, while the
 * client measured a hundred-second maximum - but nothing has ever said where
 * the missing time went instead.
 *
 * k6 has always known. Every response carries a phase breakdown, and the
 * profiles threw it away and asserted status === 200. This reads it.
 *
 * The phases, and what each one would mean here:
 *
 *   blocked          waiting for a free connection slot, or for a DNS lookup
 *                    and dial to finish. Time here is spent BEFORE a request
 *                    is sent, which the application cannot see or log.
 *   connecting       the TCP handshake itself.
 *   tls_handshaking  the TLS handshake. Should be 0 against plain http, and
 *                    anything other than 0 would be its own finding on a
 *                    machine whose TLS interception has broken two package
 *                    managers in this project.
 *   sending          writing the request.
 *   waiting          the server thinking. THIS is the only phase the
 *                    application's own log should agree with.
 *   receiving        reading the response body.
 *
 * If a ten-second request is ten seconds of `waiting`, the application is
 * lying in its own logs and the defect is in the application. If it is ten
 * seconds of `blocked` or `connecting`, it never reached the application and
 * the direction recorded in DEF-08 becomes evidence rather than a hunch.
 *
 * classify() is pure so it can be tested without k6 or a load run - see
 * tests/smoke/k6Diagnostics.api.spec.ts. It is exported separately from record()
 * for exactly that reason.
 */

/** Requests slower than this are worth describing even when they succeeded. */
export const SLOW_MS = 1000;

/**
 * Which phase dominated, and what that implicates.
 *
 * Returns the phase holding the largest share of the total, the share itself,
 * and whether that phase is one the application could account for. Takes a
 * plain object rather than a k6 response so it can be called with anything.
 */
export function classify(timings) {
  const phases = {
    blocked: timings.blocked || 0,
    connecting: timings.connecting || 0,
    tls_handshaking: timings.tls_handshaking || 0,
    sending: timings.sending || 0,
    waiting: timings.waiting || 0,
    receiving: timings.receiving || 0,
  };

  // Summed rather than taken from timings.duration: duration excludes
  // `blocked`, so a request that spent ten seconds waiting for a connection
  // slot reports a short duration and looks fast. That discrepancy is itself
  // the thing being hunted, so both numbers are kept.
  const total = Object.values(phases).reduce((sum, value) => sum + value, 0);

  let dominant = 'waiting';
  for (const [phase, value] of Object.entries(phases)) {
    if (value > phases[dominant]) dominant = phase;
  }

  // Everything except `waiting` happens outside the application's view. It
  // cannot log time it was never handed a request during.
  const serverAccountable = dominant === 'waiting' || dominant === 'receiving';

  return {
    phases,
    total,
    dominant,
    share: total > 0 ? phases[dominant] / total : 0,
    serverAccountable,
    // A duration that disagrees with the summed phases means time went
    // somewhere duration does not count, which is almost always `blocked`.
    unaccounted: Math.max(0, total - (timings.duration || 0) - phases.blocked),
  };
}

/** One line per interesting request, in a shape that greps and sorts. */
export function describe(name, response) {
  const verdict = classify(response.timings);
  const parts = Object.entries(verdict.phases)
    .filter(([, value]) => value > 0.5)
    .map(([phase, value]) => `${phase}=${value.toFixed(0)}ms`)
    .join(' ');

  return [
    `[diag] ${name}`,
    `status=${response.status}`,
    `error_code=${response.error_code || 0}`,
    `error=${JSON.stringify(response.error || '')}`,
    `duration=${(response.timings.duration || 0).toFixed(0)}ms`,
    `summed=${verdict.total.toFixed(0)}ms`,
    `dominant=${verdict.dominant}(${(verdict.share * 100).toFixed(0)}%)`,
    `server_accountable=${verdict.serverAccountable}`,
    parts,
  ].join(' ');
}

/**
 * Build a recorder bound to this run's metrics.
 *
 * Metrics are created by the caller and passed in, because k6 requires them
 * to be constructed at module scope in the script that uses them.
 */
export function recorder(metrics) {
  return function record(name, response) {
    const verdict = classify(response.timings);

    if (metrics.blocked) metrics.blocked.add(verdict.phases.blocked);
    if (metrics.connecting) metrics.connecting.add(verdict.phases.connecting);
    if (metrics.waiting) metrics.waiting.add(verdict.phases.waiting);

    const failed = response.status === 0 || response.status >= 400 || response.error_code;
    const slow = verdict.total >= SLOW_MS;

    if (failed && metrics.failures) {
      metrics.failures.add(1, {
        name,
        error_code: String(response.error_code || 0),
        status: String(response.status),
      });
    }
    if (slow && metrics.slow) {
      metrics.slow.add(1, { name, dominant: verdict.dominant });
    }

    /*
     * Logged rather than only counted. A counter says how many failed; the
     * body says why, and DEF-08 has gone unexplained partly because the
     * bodies were discarded - the entry names that as the outstanding gap.
     */
    if (failed) {
      console.error(describe(name, response));
      const body = typeof response.body === 'string' ? response.body.slice(0, 400) : '';
      if (body) console.error(`[diag] ${name} body=${JSON.stringify(body)}`);
    } else if (slow) {
      console.warn(describe(name, response));
    }

    return verdict;
  };
}
