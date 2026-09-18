import { describe, expect, it } from 'vitest';

import { findDuplication } from './duplication.js';
import type { Language } from './types.js';
import { measure, type SourceFile } from './walk.js';

function source(path: string, code: string, language: Language = 'typescript'): SourceFile {
  return { stats: measure(path, language, code), source: code };
}

/** Ten distinct statements: enough to clear both the window and diversity bars. */
function block(prefix: string): string {
  return [
    `const ${prefix}Client = createClient(config);`,
    `const ${prefix}Rows = await ${prefix}Client.query(statement);`,
    `if (!${prefix}Rows) { throw new NotFound(); }`,
    `const mapped = ${prefix}Rows.map(toDomain);`,
    `const filtered = mapped.filter(isActive);`,
    `const sorted = filtered.sort(byCreatedAt);`,
    `logger.info({ count: sorted.length });`,
    `await cache.set(cacheKey, sorted);`,
    `metrics.increment("query.success");`,
    `return sorted;`,
  ].join('\n');
}

describe('findDuplication', () => {
  it('finds a block copied into a second file', () => {
    const shared = block('user');
    const findings = findDuplication([
      source('a.ts', `function a() {\n${shared}\n}`),
      source('b.ts', `function b() {\n${shared}\n}`),
    ]);

    expect(findings.map((f) => f.rule)).toContain('duplication.cross-file');
  });

  it('reports one finding per clone site, not one per sliding window', () => {
    const shared = block('order');
    const findings = findDuplication([
      source('a.ts', `function a() {\n${shared}\n}`),
      source('b.ts', `function b() {\n${shared}\n}`),
    ]);

    // Two sites, one family: a naive sliding window would emit ~10x this.
    expect(findings.length).toBeLessThanOrEqual(2);
  });

  it('does not match across languages', () => {
    const shared = block('thing');
    const findings = findDuplication([source('a.ts', shared), source('a.py', shared, 'python')]);

    expect(findings).toHaveLength(0);
  });

  it('ignores a configuration table whose entries repeat by design', () => {
    const table = Array.from(
      { length: 12 },
      (_, i) => `  { id: "rule${i}", level: "warn", enabled: true },`,
    ).join('\n');

    const findings = findDuplication([source('rules.ts', `export const RULES = [\n${table}\n];`)]);
    expect(findings).toHaveLength(0);
  });

  it('ignores blocks shorter than the window', () => {
    const short = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const findings = findDuplication([source('a.ts', short), source('b.ts', short)]);
    expect(findings).toHaveLength(0);
  });

  it('ignores comments when comparing', () => {
    const shared = block('cart');
    const findings = findDuplication([
      source('a.ts', `// first copy\n${shared}`),
      source('b.ts', `// second copy, different comment entirely\n${shared}`),
    ]);

    expect(findings.length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty input', () => {
    expect(findDuplication([])).toEqual([]);
  });
});
