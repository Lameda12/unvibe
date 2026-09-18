import { describe, expect, it } from 'vitest';

import type { Detector, DetectorContext, Language } from '../types.js';
import { measure } from '../walk.js';
import { commentDetector } from './comments.js';
import { genericDetector } from './generic.js';
import { placeholderDetector } from './placeholders.js';
import { testTheaterDetector } from './test-theater.js';
import { tsAstDetector } from './ts-ast.js';

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

const ts = (source: string, path = 'src/a.ts') => run(tsAstDetector, path, 'typescript', source);
const py = (source: string, path = 'src/a.py') => run(genericDetector, path, 'python', source);

describe('error handling (TypeScript)', () => {
  it('flags an empty catch block', () => {
    expect(ts('try { risky(); } catch (e) {}')).toContain('error-handling.empty-catch');
  });

  it('downgrades an empty catch that explains itself', () => {
    const source = `try {
  risky();
} catch {
  // The caller treats a missing file as an empty result.
}`;
    const ctx: DetectorContext = {
      path: 'src/a.ts',
      language: 'typescript',
      source,
      lines: source.split('\n'),
      stats: measure('src/a.ts', 'typescript', source),
    };
    const finding = tsAstDetector.run(ctx).find((f) => f.rule === 'error-handling.empty-catch');
    expect(finding?.severity).toBe('low');
  });

  it('flags a catch that only logs', () => {
    expect(ts('try { a(); } catch (e) { console.error(e); }')).toContain(
      'error-handling.log-and-continue',
    );
  });

  it('flags a catch that returns an empty default', () => {
    expect(ts('function f() { try { return a(); } catch (e) { return []; } }')).toContain(
      'error-handling.swallow-default',
    );
  });

  it('leaves a catch that rethrows alone', () => {
    const rules = ts('try { a(); } catch (e) { throw new AppError("failed", e); }');
    expect(rules.filter((r) => r.startsWith('error-handling'))).toHaveLength(0);
  });

  it('leaves a catch that recovers alone', () => {
    const rules = ts('function f() { try { return a(); } catch (e) { return fallback(e); } }');
    expect(rules.filter((r) => r.startsWith('error-handling'))).toHaveLength(0);
  });

  it('flags a promise catch that swallows into null', () => {
    expect(ts('const x = fetchThing().catch(() => null);')).toContain(
      'error-handling.promise-catch-default',
    );
  });

  it('leaves a promise catch that returns a real fallback alone', () => {
    expect(ts('const x = fetchThing().catch((e) => reportAndRetry(e));')).not.toContain(
      'error-handling.promise-catch-default',
    );
  });
});

describe('error handling (Python)', () => {
  it('flags a bare except', () => {
    expect(py('try:\n    risky()\nexcept:\n    handle()\n')).toContain(
      'error-handling.bare-except',
    );
  });

  it('flags except Exception', () => {
    expect(py('try:\n    risky()\nexcept Exception as e:\n    recover(e)\n')).toContain(
      'error-handling.broad-except',
    );
  });

  it('flags a pass-only except', () => {
    expect(py('try:\n    risky()\nexcept ValueError:\n    pass\n')).toContain(
      'error-handling.empty-catch',
    );
  });

  it('flags log-and-continue', () => {
    expect(py('try:\n    risky()\nexcept ValueError as e:\n    logger.error(e)\n')).toContain(
      'error-handling.log-and-continue',
    );
  });

  it('leaves a narrow except that re-raises alone', () => {
    const rules = py('try:\n    risky()\nexcept ValueError as e:\n    raise AppError from e\n');
    expect(rules.filter((r) => r.startsWith('error-handling'))).toHaveLength(0);
  });
});

describe('type escapes', () => {
  it('flags a double assertion', () => {
    expect(ts('const x = value as unknown as Widget;')).toContain('type-escapes.double-assertion');
  });

  it('flags repeated any', () => {
    expect(ts('let a: any; let b: any; let c: any;')).toContain('type-escapes.any');
  });

  it('stays quiet about one or two any', () => {
    expect(ts('let a: any; let b: any;')).not.toContain('type-escapes.any');
  });

  it('flags an unexplained ts-ignore', () => {
    expect(ts('// @ts-ignore\nconst x = 1;')).toContain('type-escapes.ts-suppression');
  });

  it('accepts an explained ts-expect-error', () => {
    expect(
      ts('// @ts-expect-error upstream types are wrong, see #412\nconst x = 1;'),
    ).not.toContain('type-escapes.ts-suppression');
  });
});

describe('structure', () => {
  it('flags a named passthrough wrapper', () => {
    expect(ts('export function getUser(id) { return repo.getUser(id); }')).toContain(
      'structure.passthrough-wrapper',
    );
  });

  it('does not flag an inline callback that forwards its argument', () => {
    expect(ts('const out = items.filter((item) => matcher.test(item));')).not.toContain(
      'structure.passthrough-wrapper',
    );
  });

  it('does not flag a wrapper that transforms its arguments', () => {
    expect(ts('export function getUser(id) { return repo.getUser(normalize(id)); }')).not.toContain(
      'structure.passthrough-wrapper',
    );
  });

  it('flags a long function', () => {
    const body = Array.from({ length: 70 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    expect(ts(`function big() {\n${body}\n}`)).toContain('structure.long-function');
  });
});

describe('dead code', () => {
  it('flags an unused import', () => {
    expect(ts('import { unused } from "./x";\nconst a = 1;')).toContain('dead-code.unused-import');
  });

  it('leaves a used import alone', () => {
    expect(ts('import { used } from "./x";\nconst a = used();')).not.toContain(
      'dead-code.unused-import',
    );
  });
});

describe('comments', () => {
  const comments = (source: string) => run(commentDetector, 'src/a.ts', 'typescript', source);

  it('flags narration', () => {
    expect(comments('// Step 1: validate the input\nvalidate(input);')).toContain(
      'comments.narration',
    );
  });

  it('flags a hedge that admits the code is a placeholder', () => {
    expect(
      comments('// In a real implementation you would call the API here\nreturn {};'),
    ).toContain('comments.hedge');
  });

  it('flags a banner', () => {
    expect(comments('// ===================================\nconst a = 1;')).toContain(
      'comments.banner',
    );
  });

  it('flags a comment that restates the code below it', () => {
    expect(
      comments('// Calculate the total price\nconst totalPrice = calculateTotalPrice();'),
    ).toContain('comments.redundant');
  });

  it('leaves a comment that explains a decision alone', () => {
    const rules = comments(
      '// Upstream rate-limits above 10 rps, so batch rather than parallelize.\nawait batch(items);',
    );
    expect(rules).toHaveLength(0);
  });
});

describe('placeholders', () => {
  const holes = (source: string, path = 'src/a.ts') =>
    run(placeholderDetector, path, 'typescript', source);

  it('flags a not-implemented stub', () => {
    expect(holes('function f() { throw new Error("Not implemented"); }')).toContain(
      'placeholders.not-implemented',
    );
  });

  it('flags a placeholder credential', () => {
    expect(holes('const key = "your-api-key-here";')).toContain('placeholders.fake-credential');
  });

  it('flags a TODO attributed to an assistant', () => {
    expect(holes('// TODO(claude): handle the retry case')).toContain(
      'placeholders.attributed-todo',
    );
  });

  it('allows example.com inside tests', () => {
    expect(holes('const url = "https://example.com/x";', 'src/a.test.ts')).not.toContain(
      'placeholders.fake-endpoint',
    );
  });
});

describe('test theater', () => {
  const tests = (source: string) => run(testTheaterDetector, 'src/a.test.ts', 'typescript', source);

  it('flags a tautological assertion', () => {
    expect(tests('it("works", () => {\n  expect(true).toBe(true);\n});')).toContain(
      'test-theater.tautology',
    );
  });

  it('flags a test with no assertion', () => {
    expect(tests('it("works", () => {\n  doTheThing();\n});')).toContain(
      'test-theater.no-assertion',
    );
  });

  it('flags a test that only verifies a mock', () => {
    expect(
      tests('it("calls", () => {\n  run();\n  expect(spy).toHaveBeenCalled();\n});'),
    ).toContain('test-theater.mock-only');
  });

  it('leaves a real assertion alone', () => {
    const rules = tests('it("adds", () => {\n  expect(add(1, 2)).toBe(3);\n});');
    expect(rules).toHaveLength(0);
  });

  it('does not run on non-test files', () => {
    expect(run(testTheaterDetector, 'src/a.ts', 'typescript', 'expect(true).toBe(true);')).toEqual(
      [],
    );
  });
});
