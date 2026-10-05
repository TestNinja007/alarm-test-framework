import http from 'k6/http';
import { check } from 'k6';
import { API, headers, previewBody, signIn, writeHeaders } from './lib/session.js';

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
  check(upcoming, { 'upcoming answered': (r) => r.status === 200 });

  // Preview is a POST, so the CSRF guard applies even though it changes nothing.
  const preview = http.post(`${API}/alarms/preview`, previewBody(20), {
    headers: writeHeaders(data.session),
  });
  check(preview, {
    'preview answered': (r) => r.status === 200,
    'preview computed occurrences': (r) => r.json().items.length > 0,
  });
}
