/**
 * Writes the run's results onto the GitHub Actions run page.
 *
 * Without this a visitor sees four green ticks and has to download a zip to
 * learn anything else. The point of a suite is the evidence it produces, and
 * evidence nobody opens is not doing its job.
 *
 * Reads Playwright's JSON reporter output and appends Markdown to the file
 * GitHub names in GITHUB_STEP_SUMMARY. Outside Actions it prints to stdout, so
 * it is runnable locally while being changed.
 */
import { appendFileSync, readFileSync } from 'node:fs';

interface PlaywrightResult {
  status?: string;
}

interface PlaywrightTest {
  results?: PlaywrightResult[];
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  tests?: PlaywrightTest[];
}

interface PlaywrightSuite {
  title: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
  stats?: { expected: number; unexpected: number; skipped: number; duration: number };
}

function flatten(suites: PlaywrightSuite[] = []): PlaywrightSpec[] {
  return suites.flatMap((suite) => [...(suite.specs ?? []), ...flatten(suite.suites)]);
}

/** TC12 from "TC12: an unknown address is refused" — the case this proves. */
function caseId(title: string): string {
  return /^(TC\d+[a-z]?)\s*:/.exec(title)?.[1] ?? '—';
}

const [, , reportPath = 'test-results/results.json', project = 'suite'] = process.argv;

let report: PlaywrightReport;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8')) as PlaywrightReport;
} catch {
  console.error(`No report at ${reportPath}; nothing to summarise.`);
  process.exit(0);
}

const specs = flatten(report.suites);
const failed = specs.filter((spec) => !spec.ok);
const skipped = specs.filter((spec) =>
  spec.tests?.every((t) => t.results?.every((r) => r.status === 'skipped')),
);
const passed = specs.length - failed.length - skipped.length;
const seconds = ((report.stats?.duration ?? 0) / 1000).toFixed(1);

const covered = [...new Set(specs.map((spec) => caseId(spec.title)))].filter((id) => id !== '—');

const lines = [
  `## ${project}`,
  '',
  `| Passed | Failed | Skipped | Duration |`,
  `| --- | --- | --- | --- |`,
  `| ${passed} | ${failed.length} | ${skipped.length} | ${seconds}s |`,
  '',
];

if (covered.length > 0) {
  lines.push(`**Cases covered:** ${covered.sort().join(', ')}`, '');
}

if (failed.length > 0) {
  lines.push('### Failures', '');
  for (const spec of failed) {
    lines.push(`- \`${caseId(spec.title)}\` ${spec.title}`);
  }
  lines.push('');
}

const markdown = lines.join('\n');
const target = process.env.GITHUB_STEP_SUMMARY;

if (target) {
  appendFileSync(target, `${markdown}\n`);
} else {
  console.log(markdown);
}
