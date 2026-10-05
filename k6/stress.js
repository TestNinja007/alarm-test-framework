import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { API, headers, previewBody, signIn, writeHeaders } from './lib/session.js';

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
  check(response, { 'preview answered': (r) => r.status === 200 });
}
