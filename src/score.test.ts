import { describe, expect, it } from 'vitest';

import { computeScore, gradeFor, slopFromDensity, BASELINE_WEIGHT_PER_KLOC } from './score.js';
import type { FileStats, Finding, Severity } from './types.js';

function finding(severity: Severity, path = 'a.ts'): Finding {
  return {
    rule: 'comments.obvious',
    category: 'comments',
    severity,
    message: 'x',
    path,
    line: 1,
    endLine: 1,
    snippet: '',
    remediation: '',
    autofixable: false,
  };
}

function file(path: string, codeLines: number): FileStats {
  return {
    path,
    language: 'typescript',
    lines: codeLines,
    codeLines,
    commentLines: 0,
    bytes: codeLines * 30,
  };
}

describe('slopFromDensity', () => {
  it('reports zero for a codebase with no findings', () => {
    expect(slopFromDensity(0)).toBe(0);
  });

  it('places the calibrated baseline density at 20', () => {
    expect(slopFromDensity(BASELINE_WEIGHT_PER_KLOC)).toBeCloseTo(20, 0);
  });

  it('saturates rather than exceeding 100', () => {
    expect(slopFromDensity(10_000)).toBeLessThanOrEqual(100);
  });

  it('increases monotonically with density', () => {
    const points = [0, 2, 5, 10, 25, 50].map(slopFromDensity);
    const sorted = [...points].sort((a, b) => a - b);
    expect(points).toEqual(sorted);
  });

  it('treats negative density as zero rather than producing a negative score', () => {
    expect(slopFromDensity(-5)).toBe(0);
  });
});

describe('gradeFor', () => {
  it.each([
    [0, 'A'],
    [19.9, 'A'],
    [20, 'B'],
    [34.9, 'B'],
    [35, 'C'],
    [49.9, 'C'],
    [50, 'D'],
    [69.9, 'D'],
    [70, 'F'],
    [100, 'F'],
  ])('maps %d to %s', (slop, expected) => {
    expect(gradeFor(slop)).toBe(expected);
  });
});

describe('computeScore', () => {
  it('weights a high finding as twenty info findings', () => {
    const files = [file('a.ts', 1000)];
    const high = computeScore([finding('high')], files);
    const info = computeScore(
      Array.from({ length: 20 }, () => finding('info')),
      files,
    );
    expect(high.totalWeight).toBeCloseTo(info.totalWeight, 5);
  });

  it('normalizes by size, so a big clean repo beats a small dirty one', () => {
    const small = computeScore([finding('high'), finding('high')], [file('a.ts', 100)]);
    const large = computeScore([finding('high'), finding('high')], [file('a.ts', 10_000)]);
    expect(large.slop).toBeLessThan(small.slop);
  });

  it('returns a zero score for an empty codebase instead of dividing by zero', () => {
    const score = computeScore([], []);
    expect(score.slop).toBe(0);
    expect(score.grade).toBe('A');
    expect(score.weightPerKloc).toBe(0);
  });

  it('ranks hotspots by absolute weight', () => {
    const files = [file('busy.ts', 500), file('quiet.ts', 500)];
    const findings = [
      finding('high', 'busy.ts'),
      finding('high', 'busy.ts'),
      finding('low', 'quiet.ts'),
    ];
    const score = computeScore(findings, files);
    expect(score.hotspots[0]?.path).toBe('busy.ts');
    expect(score.hotspots[0]?.findings).toBe(2);
  });

  it('groups weight by category', () => {
    const score = computeScore([finding('high'), finding('low')], [file('a.ts', 100)]);
    const comments = score.byCategory.find((c) => c.category === 'comments');
    expect(comments?.findings).toBe(2);
    expect(comments?.weight).toBe(6);
  });
});
