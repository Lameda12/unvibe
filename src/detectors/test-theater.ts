import type { Detector, Finding } from '../types.js';
import { blankStrings, blockExtent, isTestPath, makeFinding } from './util.js';

/** Assertions that can never fail. */
const TAUTOLOGY = [
  /\bassert\s+True\b/,
  /\bassert\s*\(\s*true\s*[,)]/i,
  /expect\s*\(\s*true\s*\)\s*\.\s*(toBe|toEqual|toBeTruthy)\s*\(\s*(true)?\s*\)/i,
  /expect\s*\(\s*(\w+)\s*\)\s*\.\s*toBe\s*\(\s*\1\s*\)/,
  /assert\.ok\s*\(\s*true\s*\)/,
  /\bassertTrue\s*\(\s*true\s*\)/,
  /expect\s*\(\s*[^)]+\s*\)\s*\.\s*toBeDefined\s*\(\s*\)\s*;?\s*$/,
];

/** Anything that looks like it could fail. */
const ASSERTION = [
  /\bexpect\s*\(/,
  /\bassert\b/,
  /\bshould\b\s*[.(]/,
  /\bt\.(is|deepEqual|truthy|throws)\b/,
  /\bassertThat\s*\(/,
  /\brequire\.(Equal|NoError|True)\b/,
  /\bXCTAssert/,
];

/** Assertions that only prove the test's own scaffolding ran. */
const MOCK_ONLY = [
  /expect\s*\(\s*\w+\s*\)\s*\.\s*(toHaveBeenCalled|toHaveBeenCalledTimes|toHaveBeenCalledWith)\s*\(/,
  /\.assert_called(_once)?(_with)?\s*\(/,
  /verify\s*\(\s*\w+\s*\)/,
];

const TEST_START =
  /^\s*(?:async\s+)?(?:(?:it|test|describe)\s*(?:\.\w+)?\s*\(\s*['"`](.+?)['"`]|def\s+(test_\w+)|func\s+(Test\w+)|fn\s+(\w*test\w*)\s*\()/;

export const testTheaterDetector: Detector = {
  id: 'test-theater',
  category: 'test-theater',
  supports: (ctx) => isTestPath(ctx.path),
  run(ctx): Finding[] {
    const findings: Finding[] = [];
    const { path } = ctx;
    // A detector's own test suite quotes broken tests as fixtures. Blanking
    // string and template literals keeps those out of the report.
    const lines = blankStrings(ctx.source).split('\n');

    lines.forEach((raw, index) => {
      if (TAUTOLOGY.some((pattern) => pattern.test(raw))) {
        findings.push(
          makeFinding({
            rule: 'test-theater.tautology',
            category: 'test-theater',
            severity: 'high',
            message: 'Assertion cannot fail.',
            path,
            line: index + 1,
            snippet: ctx.lines[index] ?? raw,
            remediation:
              'Assert the behaviour the test is named after, or delete the test. A green tautology is worse than no test: it buys false confidence.',
          }),
        );
      }
    });

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i]!;
      const match = TEST_START.exec(raw);
      if (!match) continue;

      const name = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '<test>';
      const end = blockExtent(lines, i);
      if (end <= i) continue;

      const body = lines.slice(i + 1, end + 1);
      // A `describe` block holds other tests, not assertions of its own.
      if (/\bdescribe\s*\(/.test(raw)) continue;
      if (body.some((line) => TEST_START.test(line))) continue;

      // An async test declares a completion callback and fails by passing it an
      // error, or by never calling it. That is a real pass/fail condition, so
      // referencing the callback counts as asserting.
      const callbackName = /\(\s*(?:function\s*)?\(?\s*(done|cb|callback)\b/.exec(
        raw.slice(raw.indexOf(',') + 1),
      )?.[1];
      const usesCallback =
        callbackName !== undefined &&
        body.some((line) => new RegExp(`\\b${callbackName}\\b`).test(line));

      const hasAssertion = usesCallback || body.some((line) => ASSERTION.some((p) => p.test(line)));

      if (!hasAssertion) {
        findings.push(
          makeFinding({
            rule: 'test-theater.no-assertion',
            category: 'test-theater',
            severity: 'high',
            message: `Test "${name}" asserts nothing.`,
            path,
            line: i + 1,
            endLine: end + 1,
            snippet: raw,
            remediation:
              'It only proves the code does not throw. State the expected outcome, or drop it.',
          }),
        );
        continue;
      }

      const assertionLines = body.filter((line) => ASSERTION.some((p) => p.test(line)));
      const allMockAssertions =
        assertionLines.length > 0 &&
        assertionLines.every((line) => MOCK_ONLY.some((p) => p.test(line)));

      if (allMockAssertions) {
        findings.push(
          makeFinding({
            rule: 'test-theater.mock-only',
            category: 'test-theater',
            severity: 'medium',
            message: `Test "${name}" only asserts that mocks were called.`,
            path,
            line: i + 1,
            endLine: end + 1,
            snippet: raw,
            remediation:
              'Assert the result the caller gets. Verifying your own mock tests the wiring of the test, not the code.',
          }),
        );
      }
    }

    return findings;
  },
};
