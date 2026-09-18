import { describe, expect, it } from 'vitest';

import type { Detector, DetectorContext, Language } from '../types.js';
import { measure } from '../walk.js';
import { commentDetector } from './comments.js';
import { placeholderDetector } from './placeholders.js';
import { testTheaterDetector } from './test-theater.js';
import { tsAstDetector } from './ts-ast.js';
import { blockExtent, isExamplePath, isTestPath, jsDocLines } from './util.js';

/**
 * These are the false positives that made unvibe grade Express an F on its first
 * run. Each one cost a real calibration pass; they stay here so they cannot
 * quietly come back.
 */

function run(detector: Detector, path: string, language: Language, source: string): string[] {
  const ctx: DetectorContext = {
    path,
    language,
    source,
    lines: source.split('\n'),
    stats: measure(path, language, source),
  };
  if (!detector.supports(ctx)) return [];
  return detector.run(ctx).map((finding) => finding.rule);
}

describe('path classification', () => {
  it.each(['test/app.js', 'src/__tests__/a.ts', 'src/a.test.ts', 'tests/b.py', 'test_thing.py'])(
    'treats %s as a test',
    (path) => {
      expect(isTestPath(path)).toBe(true);
    },
  );

  it.each(['src/app.ts', 'lib/response.js', 'contest/entry.ts'])(
    'does not treat %s as a test',
    (path) => {
      expect(isTestPath(path)).toBe(false);
    },
  );

  it.each(['examples/vhost/index.js', 'demo/app.ts', 'benchmarks/run.js'])(
    'treats %s as illustrative',
    (path) => {
      expect(isExamplePath(path)).toBe(true);
    },
  );
});

describe('JSDoc is documentation, not narration', () => {
  const source = `/**
 * Check if \`setting\` is enabled.
 * Return the value.
 */
export function enabled(setting: string) {
  return settings[setting];
}`;

  it('identifies the JSDoc line range', () => {
    expect(jsDocLines(source.split('\n'))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('does not flag an API description as an obvious comment', () => {
    expect(run(commentDetector, 'lib/app.ts', 'typescript', source)).not.toContain(
      'comments.obvious',
    );
  });

  it('still flags the same wording in a plain comment', () => {
    expect(
      run(commentDetector, 'lib/app.ts', 'typescript', '// Check if enabled\nif (on) {}'),
    ).toContain('comments.obvious');
  });

  it('still flags a hedge inside JSDoc, because that is unfinished work', () => {
    const hedged = `/**
 * In a real implementation this would call the API.
 */
export function f() {}`;
    expect(run(commentDetector, 'lib/a.ts', 'typescript', hedged)).toContain('comments.hedge');
  });
});

describe('test files are not measured like production code', () => {
  const longTest = [
    "describe('a suite', () => {",
    ...Array.from(
      { length: 80 },
      (_, i) => `  it('case ${i}', () => { expect(f(${i})).toBe(${i}); });`,
    ),
    '});',
  ].join('\n');

  it('does not flag a long describe block', () => {
    expect(run(tsAstDetector, 'test/a.test.ts', 'typescript', longTest)).not.toContain(
      'structure.long-function',
    );
  });

  it('does not flag a long test file as a god file', () => {
    const huge = Array.from(
      { length: 800 },
      (_, i) => `it('c${i}', () => expect(1).toBe(1));`,
    ).join('\n');
    expect(run(tsAstDetector, 'test/a.test.ts', 'typescript', huge)).not.toContain(
      'structure.god-file',
    );
  });

  it('still flags a long function in production code', () => {
    const body = Array.from({ length: 70 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    expect(run(tsAstDetector, 'src/a.ts', 'typescript', `function big() {\n${body}\n}`)).toContain(
      'structure.long-function',
    );
  });

  it('does not report placeholder fixtures inside a test', () => {
    const fixture = 'const key = "your-api-key-here";\nexpect(scan(key)).toHaveLength(1);';
    expect(run(placeholderDetector, 'src/a.test.ts', 'typescript', fixture)).toEqual([]);
  });

  it('does not report placeholders inside an example', () => {
    expect(
      run(placeholderDetector, 'examples/basic/index.js', 'javascript', 'const k = "changeme";'),
    ).toEqual([]);
  });

  it('still reports a placeholder in production code', () => {
    expect(run(placeholderDetector, 'src/a.ts', 'typescript', 'const k = "changeme";')).toContain(
      'placeholders.fake-credential',
    );
  });
});

describe('async tests signal failure through their callback', () => {
  it('accepts a done-callback test with no explicit assertion', () => {
    const source = `it('emits foo', function (done) {
  app.on('foo', done);
  app.emit('foo');
});`;
    expect(run(testTheaterDetector, 'test/a.js', 'javascript', source)).not.toContain(
      'test-theater.no-assertion',
    );
  });

  it('still flags a synchronous test that asserts nothing', () => {
    const source = `it('does a thing', function () {
  doTheThing();
  andAnother();
});`;
    expect(run(testTheaterDetector, 'test/a.js', 'javascript', source)).toContain(
      'test-theater.no-assertion',
    );
  });

  it('ignores a broken test quoted as a fixture', () => {
    const source = [
      "const fixture = `it('x', () => { expect(true).toBe(true); });`;",
      "it('detects it', () => { expect(scan(fixture)).toHaveLength(1); });",
    ].join('\n');
    expect(run(testTheaterDetector, 'src/a.test.ts', 'typescript', source)).toEqual([]);
  });
});

describe('facade delegation is a design decision', () => {
  it('does not flag delegation through this', () => {
    expect(
      run(
        tsAstDetector,
        'src/a.ts',
        'typescript',
        'class A { route(p) { return this.r.route(p); } }',
      ),
    ).not.toContain('structure.passthrough-wrapper');
  });

  it('still flags a free-function passthrough', () => {
    expect(
      run(tsAstDetector, 'src/a.ts', 'typescript', 'export function go(p) { return doIt(p); }'),
    ).toContain('structure.passthrough-wrapper');
  });
});

describe('blockExtent', () => {
  it('follows braces past a zero-indented template literal', () => {
    const lines = [
      "  it('x', () => {",
      '    const s = `line one',
      'line two at column zero',
      '`;',
      '    expect(s).toBeTruthy();',
      '  });',
    ];
    // Indentation alone would stop at the backtick line and miss the assertion.
    expect(blockExtent(lines, 0)).toBe(5);
  });

  it('falls back to indentation for a Python block', () => {
    const lines = ['def f():', '    a = 1', '    b = 2', 'def g():'];
    expect(blockExtent(lines, 0)).toBe(2);
  });

  it('does not run past the end when braces never balance', () => {
    const lines = ['function broken() {', '  const a = 1;'];
    expect(blockExtent(lines, 0)).toBe(1);
  });
});
