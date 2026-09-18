import { describe, expect, it } from 'vitest';

import { IgnoreMatcher } from './gitignore.js';

function matcher(...patterns: string[]): IgnoreMatcher {
  const m = new IgnoreMatcher();
  for (const pattern of patterns) m.add(pattern);
  return m;
}

describe('IgnoreMatcher', () => {
  it('ignores a directory and everything under it', () => {
    const m = matcher('dist/');
    expect(m.ignores('dist', true)).toBe(true);
    expect(m.ignores('dist/bundle.js')).toBe(true);
    expect(m.ignores('src/index.ts')).toBe(false);
  });

  it('matches an unanchored name at any depth', () => {
    const m = matcher('node_modules');
    expect(m.ignores('node_modules/a.js')).toBe(true);
    expect(m.ignores('packages/web/node_modules/a.js')).toBe(true);
  });

  it('anchors a pattern containing a slash', () => {
    const m = matcher('/build');
    expect(m.ignores('build/a.js')).toBe(true);
    expect(m.ignores('packages/build/a.js')).toBe(false);
  });

  it('expands a glob within one segment', () => {
    const m = matcher('*.min.js');
    expect(m.ignores('vendor/jquery.min.js')).toBe(true);
    expect(m.ignores('vendor/jquery.js')).toBe(false);
  });

  it('lets a later negation win', () => {
    const m = matcher('generated/', '!generated/keep.ts');
    expect(m.ignores('generated/a.ts')).toBe(true);
    expect(m.ignores('generated/keep.ts')).toBe(false);
  });

  it('skips comments and blank lines', () => {
    const m = matcher('# a comment', '', '   ');
    expect(m.size).toBe(0);
  });

  it('does not let a pattern escape into a regex', () => {
    const m = matcher('a+b.txt');
    expect(m.ignores('a+b.txt')).toBe(true);
    expect(m.ignores('aab.txt')).toBe(false);
  });

  it('ignores nothing when it has no rules', () => {
    expect(new IgnoreMatcher().ignores('anything.ts')).toBe(false);
  });
});
