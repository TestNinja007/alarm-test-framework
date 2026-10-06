import type { APIRequestContext, APIResponse } from '@playwright/test';
import { apiPath } from './env.js';

/**
 * A thin wrapper over Playwright's request context that knows two things the
 * API insists on.
 *
 * The session is a cookie, which Playwright's context carries by itself. But
 * every mutating request also needs an `x-csrf-token` header, and the token is
 * only handed out by the endpoint that creates the session. Forgetting it
 * produces a 403 that looks like an authorisation bug and is not one, so the
 * client adds it rather than leaving it to each test to remember.
 */
export class ApiClient {
  private csrfToken: string | undefined;

  constructor(private readonly request: APIRequestContext) {}

  /** The token for the current session, once there is one. */
  get csrf(): string | undefined {
    return this.csrfToken;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      ...(this.csrfToken ? { 'x-csrf-token': this.csrfToken } : {}),
      ...extra,
    };
  }

  async get(path: string, params?: Record<string, string | number | boolean>): Promise<APIResponse> {
    return this.request.get(apiPath(path), { headers: this.headers(), params });
  }

  async post(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.post(apiPath(path), { headers: this.headers(), data: data ?? {} });
  }

  async put(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.put(apiPath(path), { headers: this.headers(), data: data ?? {} });
  }

  async patch(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.patch(apiPath(path), { headers: this.headers(), data: data ?? {} });
  }

  /**
   * `data` is optional because most deletes need none — but deleting an
   * account is password-confirmed, and a DELETE that cannot carry a body
   * cannot exercise it.
   */
  async delete(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.delete(apiPath(path), {
      headers: this.headers(),
      ...(data === undefined ? {} : { data }),
    });
  }

  /**
   * Signs in and remembers the CSRF token.
   *
   * Returns the response rather than throwing, because a test of a failed
   * sign-in needs the 401 as much as a passing test needs the 200.
   */
  async signIn(email: string, password: string): Promise<APIResponse> {
    const response = await this.request.post(apiPath('/auth/login'), {
      data: { email, password },
    });
    if (response.ok()) {
      const body = (await response.json()) as { csrfToken?: string };
      this.csrfToken = body.csrfToken;
    }
    return response;
  }

  async signOut(): Promise<APIResponse> {
    const response = await this.post('/auth/logout');
    this.csrfToken = undefined;
    return response;
  }

  /**
   * A mutating request with the CSRF header under the caller's control.
   *
   * Every other method here adds the token, which is the right default and
   * makes the guard untestable: a client that cannot omit the header cannot
   * check that omitting it is refused. Pass `{}` for no token at all, or a
   * wrong one.
   */
  async postRaw(
    path: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<APIResponse> {
    return this.request.post(apiPath(path), { headers, data: data ?? {} });
  }

  /** Reads the token back from the session, after a sign-in done elsewhere. */
  async adoptSession(): Promise<void> {
    const response = await this.request.get(apiPath('/auth/me'));
    if (!response.ok()) throw new Error(`Not signed in: ${response.status()}`);
    const body = (await response.json()) as { csrfToken?: string };
    this.csrfToken = body.csrfToken;
  }

  /** Parses a JSON body and fails with the status when the call did not succeed. */
  async json<T>(response: APIResponse): Promise<T> {
    if (!response.ok()) {
      throw new Error(`${response.status()} ${response.url()} — ${await response.text()}`);
    }
    return (await response.json()) as T;
  }
}
