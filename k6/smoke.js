import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { API, headers, previewBody, signIn, writeHeaders } from './lib/session.js';
import { recorder } from './lib/diagnose.js';

/*
 * The diagnostics run here too, at one virtual user.
 *
 * This profile exists to prove the script before a long run, and the
 * instrumentation is part of the script: a smoke run that prints a [diag] line
 * for a deliberately slow request is how anyone confirms the DEF-08 wiring
 * works before spending ten minutes on a stress run that depends on it.
 */
const phaseBlocked = new Trend('phase_blocked', true);
const phaseConnecting = new Trend('phase_connecting', true);
const phaseWaiting = new Trend('phase_waiting', true);
const failures = new Counter('diag_failures');
const slowRequests = new Counter('diag_slow');

const record = recorder({
  blocked: phaseBlocked,
  connecting: phaseConnecting,
  waiting: phaseWaiting,
  failures,
  slow: slowRequests,
});

/**
 * One virtual user, briefly.
 *
 * Not a performance test. It proves the script, the credentials and the target
 * all work before a longer run spends ten minutes discovering they did not.
 */

export const options = {
  vus: 1,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<1000'],
  },
};

export function setup() {
  return { session: signIn() };
}

export default function (data) {
  const read = { headers: headers(data.session) };

  const upcoming = http.get(`${API}/me/upcoming?withinMinutes=60`, read);
  record('GET /me/upcoming', upcoming);
  check(upcoming, { 'upcoming answered': (r) => r.status === 200 });

  // Preview is a POST, so the CSRF guard applies even though it changes nothing.
  const preview = http.post(`${API}/alarms/preview`, previewBody(20), {
    headers: writeHeaders(data.session),
  });
  record('POST /alarms/preview', preview);
  check(preview, {
    'preview answered': (r) => r.status === 200,
    'preview computed occurrences': (r) => r.json().items.length > 0,
  });
}
