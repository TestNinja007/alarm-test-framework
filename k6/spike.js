import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { API, headers, signIn } from './lib/session.js';
import { recorder } from './lib/diagnose.js';
/*
 * DEF-08's instrumentation. See k6/lib/diagnose.js - these separate the time
 * the application can account for (`waiting`) from the time it never saw
 * (`blocked`, `connecting`), which a client-side duration alone cannot.
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
 * Quiet, then suddenly not.
 *
 * Models what happens on the hour, when every open tab polls at once. The
 * question is not whether it is slow during the spike - it will be - but
 * whether it recovers afterwards, or stays degraded because a queue built up
 * that it never drains.
 */

export const options = {
  stages: [
    { duration: '20s', target: 5 },
    { duration: '5s', target: 100 },
    { duration: '20s', target: 100 },
    { duration: '5s', target: 5 },
    { duration: '40s', target: 5 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.1'],
  },
};

export function setup() {
  return { session: signIn() };
}

export default function (data) {
  const response = http.get(`${API}/me/upcoming?withinMinutes=60`, {
    headers: headers(data.session),
    tags: { name: 'GET /me/upcoming' },
  });
  record('GET /me/upcoming', response);
  check(response, { 'upcoming answered': (r) => r.status === 200 });
}
