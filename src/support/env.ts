import { config as loadDotenv } from 'dotenv';

loadDotenv({ quiet: true });

/**
 * Everything the suite needs to know about where the application is.
 *
 * Read once, here, rather than reaching for process.env from inside tests: a
 * test that reads its own environment is a test that behaves differently
 * depending on who ran it.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env, or set it in the CI environment.`,
    );
  }
  return value;
}

export const env = {
  /** Where the application is served. The API and the UI share one origin. */
  baseUrl: process.env.BASE_URL ?? 'http://127.0.0.1:8080',

  apiPrefix: '/api/v1',

  /**
   * Direct database access, for assertions the API cannot make — that a
   * cascade really removed the rows, that a column holds UTC.
   *
   * Optional: the suite runs without it, and only the specs tagged @db are
   * skipped.
   */
  databaseUrl: process.env.DATABASE_URL,

  /**
   * Credentials from the application's own seed profile, not invented here.
   * If the seed changes these change with it, and the suite fails loudly
   * rather than mysteriously.
   */
  seededUser: {
    email: 'user-one@example.com',
    password: 'Password123!',
    name: 'Ada Mercer',
  },
  seededAdmin: {
    email: 'admin@example.com',
    password: 'Password123!',
  },
} as const;

export function apiPath(path: string): string {
  return `${env.apiPrefix}${path.startsWith('/') ? path : `/${path}`}`;
}

export function requireDatabaseUrl(): string {
  return env.databaseUrl ?? required('DATABASE_URL');
}
