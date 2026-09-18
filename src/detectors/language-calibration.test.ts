import { describe, expect, it } from 'vitest';

import type { Detector, DetectorContext, Finding, Language } from '../types.js';
import { measure } from '../walk.js';
import { commentDetector } from './comments.js';
import { genericDetector } from './generic.js';
import { placeholderDetector } from './placeholders.js';
import { testTheaterDetector } from './test-theater.js';
import { blankStrings, blockExtent, licenseHeaderLines, pythonAbstractLines } from './util.js';

/**
 * The second calibration pass. The first graded Express an F on JavaScript; this
 * one came from `psf/requests` grading an F and VS Code producing 26,000
 * findings from its licence header. Every case below is lifted from real source
 * in one of those repos.
 */

function run(detector: Detector, path: string, language: Language, source: string): Finding[] {
  const ctx: DetectorContext = {
    path,
    language,
    source,
    lines: source.split('\n'),
    stats: measure(path, language, source),
  };
  if (!detector.supports(ctx)) return [];
  return detector.run(ctx);
}

const rules = (findings: Finding[]) => findings.map((f) => f.rule);

describe('licence headers are not banners', () => {
  const vscodeHeader = [
    '/*---------------------------------------------------------------------------------------------',
    ' *  Copyright (c) Microsoft Corporation. All rights reserved.',
    ' *  Licensed under the MIT License. See License.txt for license information.',
    ' *--------------------------------------------------------------------------------------------*/',
    '',
    'export const x = 1;',
  ].join('\n');

  it('recognises the whole header block', () => {
    expect(licenseHeaderLines(vscodeHeader.split('\n')).size).toBe(4);
  });

  it('produces no findings for it', () => {
    expect(rules(run(commentDetector, 'src/a.ts', 'typescript', vscodeHeader))).toEqual([]);
  });

  it('still flags a decorative banner that is not a licence', () => {
    const banner = '// =====================================\nconst a = 1;';
    expect(rules(run(commentDetector, 'src/a.ts', 'typescript', banner))).toContain(
      'comments.banner',
    );
  });

  it('ignores an encoding pragma', () => {
    const source = '# -*- coding: utf-8 -*-\nimport os\n';
    expect(rules(run(commentDetector, 'src/a.py', 'python', source))).toEqual([]);
  });
});

describe('Python except blocks are scored by how specific they are', () => {
  const wrap = (clause: string, body = '    pass') =>
    `try:\n    risky()\nexcept ${clause}:\n${body}\n`;

  it('says nothing about an optional-dependency probe', () => {
    const found = run(genericDetector, 'src/a.py', 'python', wrap('ImportError'));
    expect(rules(found).filter((r) => r.startsWith('error-handling'))).toEqual([]);
  });

  it('treats a narrow ignored exception as low, not high', () => {
    const found = run(genericDetector, 'src/a.py', 'python', wrap('UnicodeDecodeError'));
    const empty = found.find((f) => f.rule === 'error-handling.empty-catch');
    expect(empty?.severity).toBe('low');
  });

  it('keeps a bare except at high', () => {
    const found = run(genericDetector, 'src/a.py', 'python', 'try:\n    a()\nexcept:\n    pass\n');
    const empty = found.find((f) => f.rule === 'error-handling.empty-catch');
    expect(empty?.severity).toBe('high');
  });

  it('downgrades further when the block explains itself', () => {
    const explained = wrap(
      'UnicodeDecodeError',
      '    # Wrong codec; the server did not say.\n    pass',
    );
    const found = run(genericDetector, 'src/a.py', 'python', explained);
    expect(found.find((f) => f.rule === 'error-handling.empty-catch')?.severity).toBe('info');
  });

  it('does not treat a predicate returning False as a swallowed error', () => {
    const source =
      'def is_ascii(s):\n    try:\n        s.encode("ascii")\n        return True\n    except UnicodeEncodeError:\n        return False\n';
    expect(rules(run(genericDetector, 'src/a.py', 'python', source))).not.toContain(
      'error-handling.swallow-default',
    );
  });

  it('still flags a broad except that returns None', () => {
    const source =
      'def f():\n    try:\n        return load()\n    except Exception:\n        return None\n';
    expect(rules(run(genericDetector, 'src/a.py', 'python', source))).toContain(
      'error-handling.swallow-default',
    );
  });
});

describe('a narrowed type-ignore is the recommended form', () => {
  it('says nothing about `# type: ignore[assignment]`', () => {
    const source = 'from x import y  # type: ignore[assignment]\n';
    expect(rules(run(genericDetector, 'src/a.py', 'python', source))).not.toContain(
      'type-escapes.mypy-suppression',
    );
  });

  it('still flags a blanket `# type: ignore`', () => {
    const source = 'from x import y  # type: ignore\n';
    expect(rules(run(genericDetector, 'src/a.py', 'python', source))).toContain(
      'type-escapes.mypy-suppression',
    );
  });
});

describe('abstract methods are not stubs', () => {
  it.each([
    'class Base(ABC):\n    def get(self):\n        raise NotImplementedError\n',
    'class AuthBase:\n    def __call__(self, r):\n        raise NotImplementedError\n',
    'class Thing:\n    @abstractmethod\n    def get(self):\n        raise NotImplementedError\n',
  ])('exempts %#', (source) => {
    expect(pythonAbstractLines(source.split('\n')).size).toBeGreaterThan(0);
    expect(rules(run(placeholderDetector, 'src/a.py', 'python', source))).not.toContain(
      'placeholders.not-implemented',
    );
  });

  it('still flags a stub in a concrete function', () => {
    const source = 'def fetch(url):\n    raise NotImplementedError\n';
    expect(rules(run(placeholderDetector, 'src/a.py', 'python', source))).toContain(
      'placeholders.not-implemented',
    );
  });
});

describe('blankStrings skips comments', () => {
  it('does not let an apostrophe in a comment swallow the rest of the file', () => {
    const source = ["# the server doesn't send chunks", 'assert value == 1;'].join('\n');
    // Without comment skipping, the apostrophe opens a string that blanks
    // everything after it, hiding every assertion below.
    expect(blankStrings(source)).toContain('assert value == 1');
  });

  it('still blanks real string contents', () => {
    expect(blankStrings('const a = "secret";')).not.toContain('secret');
  });

  it('finds a pytest assertion below an apostrophe comment', () => {
    const source = [
      'def test_thing():',
      "    # The server doesn't provide valid chunks",
      '    with pytest.raises(ValueError):',
      '        go()',
    ].join('\n');
    expect(rules(run(testTheaterDetector, 'tests/test_a.py', 'python', source))).toEqual([]);
  });
});

describe('pytest and unittest idioms count as assertions', () => {
  it.each([
    '    with pytest.raises(ValueError):\n        go()',
    '    self.assertEqual(a, b)',
    '    np.testing.assert_allclose(a, b)',
  ])('accepts %#', (body) => {
    const source = `def test_thing():\n${body}\n`;
    expect(rules(run(testTheaterDetector, 'tests/test_a.py', 'python', source))).not.toContain(
      'test-theater.no-assertion',
    );
  });
});

describe('wrapped signatures do not truncate the block', () => {
  it('measures a test whose parameters span lines', () => {
    const lines = [
      'def test_proxy(',
      '    self, url, has_proxy_auth',
      '):',
      '    session = Session()',
      '    assert session.proxies == {}',
    ];
    expect(blockExtent(lines, 0)).toBe(4);
  });

  it('sees the assertion inside a wrapped-signature test', () => {
    const source = [
      'def test_proxy(',
      '    self, url, has_proxy_auth',
      '):',
      '    assert prepared.headers == {}',
    ].join('\n');
    expect(rules(run(testTheaterDetector, 'tests/test_a.py', 'python', source))).toEqual([]);
  });
});

describe('comment rules require the whole comment to be noise', () => {
  it('does not flag a comment that explains why', () => {
    const source = '# Import encoding now, to avoid an implicit import later.\nimport codecs\n';
    expect(rules(run(commentDetector, 'src/a.py', 'python', source))).not.toContain(
      'comments.obvious',
    );
  });

  it('still flags the bare restatement', () => {
    const source = '# Import codecs\nimport codecs\n';
    expect(rules(run(commentDetector, 'src/a.py', 'python', source))).toContain('comments.obvious');
  });

  it('does not treat a listing comment as a check-if', () => {
    const source = '# Check if file, fo, generator, iterator.\nif is_stream(data):\n    pass\n';
    expect(rules(run(commentDetector, 'src/a.py', 'python', source))).not.toContain(
      'comments.obvious',
    );
  });
});

describe('test files are not measured as production code in any language', () => {
  it('does not flag a long Python test file', () => {
    const source = Array.from({ length: 800 }, (_, i) => `x${i} = ${i}`).join('\n');
    expect(rules(run(genericDetector, 'tests/test_big.py', 'python', source))).not.toContain(
      'structure.god-file',
    );
  });

  it('does not treat a test fixture hedge as unfinished production code', () => {
    const source = '# For simplicity, assume the client cert is valid.\nsetup()\n';
    expect(
      rules(run(commentDetector, 'tests/testserver/server.py', 'python', source)),
    ).not.toContain('comments.hedge');
  });

  it('still flags the same hedge in production code', () => {
    const source = '# For simplicity, assume the client cert is valid.\nsetup()\n';
    expect(rules(run(commentDetector, 'src/server.py', 'python', source))).toContain(
      'comments.hedge',
    );
  });
});
