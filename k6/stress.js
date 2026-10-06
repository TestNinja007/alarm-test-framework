import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { API, headers, previewBody, signIn, writeHeaders } from './lib/session.js';
import { recorder } from './lib/diagnose.js';

/**
 * Past the comfortable point, to find where it bends.
 *
 * Steps upward rather than ramping smoothly, so the level at which latency
 * turns is readable from the graph instead of being inferred from a curve.
 *
 * No latency threshold: the point of a stress test is to find the limit, and a
 * run that fails its thresholds has succeeded. Only the error rate is asserted,
 * and generously - what matters is whether the application degrades or breaks.
 */

const preview = new Trend('endpoint_preview', true);

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


export const options = {
  stages: [
    { duration: '20s', target: 25 },
    { duration: '30s', target: 25 },
    { duration: '20s', target: 50 },
    { duration: '30s', target: 50 },
    { duration: '20s', target: 100 },
    { duration: '30s', target: 100 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    // Slow is acceptable under stress. Refusing to answer is not.
    http_req_failed: ['rate<0.05'],
  },
};

export function setup() {
  return { session: signIn() };
}

export default function (data) {
  // Preview is a POST, so the CSRF guard applies even though it changes nothing.
  const response = http.post(`${API}/alarms/preview`, previewBody(50), {
    headers: writeHeaders(data.session),
    tags: { name: 'POST /alarms/preview' },
  });
  preview.add(response.timings.duration);
  record('POST /alarms/preview', response);
  check(response, { 'preview answered': (r) => r.status === 200 });
}
