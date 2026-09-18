import type { Detector, DetectorContext, Finding, Language, Severity } from '../types.js';
import { blockExtent, indentOf, isJsFamily, isTestPath, makeFinding } from './util.js';

const MAX_FUNCTION_LINES = 60;
const MAX_FILE_LINES = 600;
const MAX_NESTING = 4;

const FUNCTION_START: Partial<Record<Language, RegExp>> = {
  python: /^\s*(async\s+)?def\s+(\w+)\s*\(/,
  go: /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/,
  rust: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[(<]/,
  ruby: /^\s*def\s+([\w.?!]+)/,
  java: /^\s*(?:public|private|protected|static|final|\s)*[\w<>\[\],\s]+\s+(\w+)\s*\([^;]*\)\s*\{/,
  csharp:
    /^\s*(?:public|private|protected|internal|static|async|\s)*[\w<>\[\],\s]+\s+(\w+)\s*\([^;]*\)\s*\{?/,
  php: /^\s*(?:public|private|protected|static|\s)*function\s+(\w+)\s*\(/,
};

/** Values a Python except block returns when it is giving up. */
/**
 * Values that lose the failure. `False` is deliberately absent: a predicate
 * answering `return False` on `UnicodeEncodeError` is returning its result.
 */
const PY_EMPTYISH = /^return\s*(None|\[\]|\{\}|""|'')?\s*$/;
const PY_LOGGING = /^(print|logging\.\w+|logger\.\w+|log\.\w+|sys\.stderr\.write)\s*\(/;

/**
 * How much the `except` clause actually commits to. This is the whole signal:
 * `except ImportError: pass` states precisely which failure it expects and what
 * it means, while a bare `except: pass` states nothing at all. Scoring them the
 * same makes every idiomatic Python file look reckless.
 */
type ExceptBreadth = 'bare' | 'broad' | 'narrow';

function breadthOf(clause: string): ExceptBreadth {
  if (clause === '') return 'bare';
  if (/^(Exception|BaseException)(\s+as\s+\w+)?$/.test(clause)) return 'broad';
  return 'narrow';
}

/**
 * Exceptions whose whole purpose is to be caught and ignored: probing for an
 * optional dependency, or duck-typing an attribute. Silence is the correct
 * handling, and flagging it teaches people to distrust the tool.
 */
const EXPECTED_FAILURES = /^(ImportError|ModuleNotFoundError|AttributeError)\b/;

function stepDown(severity: Severity): Severity {
  const order: Severity[] = ['high', 'medium', 'low', 'info'];
  return order[Math.min(order.length - 1, order.indexOf(severity) + 1)]!;
}

function pythonErrorHandling(ctx: DetectorContext): Finding[] {
  const findings: Finding[] = [];
  const { lines, path } = ctx;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const trimmed = raw.trim();

    const match = /^except\b\s*(.*?)\s*:\s*$/.exec(trimmed);
    if (!match) continue;

    const clause = match[1] ?? '';
    const line = i + 1;
    const end = blockExtent(lines, i);
    const breadth = breadthOf(clause);

    const bodyLines = lines.slice(i + 1, end + 1).map((l) => l.trim());
    const body = bodyLines.filter((l) => l && !l.startsWith('#'));
    // A commented block is a decision someone wrote down, same as in JS.
    const explained = bodyLines.some((l) => l.startsWith('#'));

    if (breadth === 'bare') {
      findings.push(
        makeFinding({
          rule: 'error-handling.bare-except',
          category: 'error-handling',
          severity: 'high',
          message: 'Bare `except:` catches KeyboardInterrupt and SystemExit too.',
          path,
          line,
          endLine: end + 1,
          snippet: raw,
          remediation: 'Catch the exceptions you can actually handle, or use `except Exception:`.',
        }),
      );
    } else if (breadth === 'broad') {
      findings.push(
        makeFinding({
          rule: 'error-handling.broad-except',
          category: 'error-handling',
          severity: 'medium',
          message: 'Catches every exception type.',
          path,
          line,
          endLine: end + 1,
          snippet: raw,
          remediation:
            'Name the exceptions this block knows how to recover from. A blanket catch hides typos as readily as network errors.',
        }),
      );
    }

    // Probing for an optional dependency is not error handling to fix.
    if (breadth === 'narrow' && EXPECTED_FAILURES.test(clause)) continue;

    if (body.length === 0 || (body.length === 1 && body[0] === 'pass')) {
      const base: Severity = breadth === 'narrow' ? 'low' : 'high';
      findings.push(
        makeFinding({
          rule: 'error-handling.empty-catch',
          category: 'error-handling',
          severity: explained ? stepDown(base) : base,
          message:
            breadth === 'narrow'
              ? `\`${clause}\` is caught and ignored.`
              : 'Except block silently swallows the exception.',
          path,
          line,
          endLine: end + 1,
          snippet: raw,
          remediation:
            'Handle it, re-raise it, or narrow the try so the failure you are ignoring is the only one that can land here.',
        }),
      );
      continue;
    }

    if (body.every((l) => PY_LOGGING.test(l))) {
      const base: Severity = breadth === 'narrow' ? 'low' : 'medium';
      findings.push(
        makeFinding({
          rule: 'error-handling.log-and-continue',
          category: 'error-handling',
          severity: explained ? stepDown(base) : base,
          message: 'Except block logs the exception and continues.',
          path,
          line,
          endLine: end + 1,
          snippet: raw,
          remediation:
            'Decide what the caller sees. Logging is not handling unless the operation was genuinely optional.',
        }),
      );
      continue;
    }

    const returnsEmpty = body
      .filter((l) => l.startsWith('return'))
      .some((l) => PY_EMPTYISH.test(l));
    const onlyLogsAndReturns = body.every((l) => PY_LOGGING.test(l) || l.startsWith('return'));
    if (returnsEmpty && onlyLogsAndReturns) {
      const base: Severity = breadth === 'narrow' ? 'low' : 'high';
      findings.push(
        makeFinding({
          rule: 'error-handling.swallow-default',
          category: 'error-handling',
          severity: explained ? stepDown(base) : base,
          message: 'Except block replaces the exception with an empty default value.',
          path,
          line,
          endLine: end + 1,
          snippet: raw,
          remediation:
            'Raise, or return something the caller can tell apart from a successful empty result.',
        }),
      );
    }
  }

  return findings;
}

function pythonTypeEscapes(ctx: DetectorContext): Finding[] {
  const findings: Finding[] = [];
  let anyCount = 0;
  let firstAnyLine = 0;

  ctx.lines.forEach((raw, index) => {
    // `# type: ignore[assignment]` names the error it silences, which is
    // exactly what the blanket-ignore remediation asks for. Only the blanket
    // form is a finding.
    if (/#\s*type:\s*ignore(?!\s*\[)/.test(raw)) {
      findings.push(
        makeFinding({
          rule: 'type-escapes.mypy-suppression',
          category: 'type-escapes',
          severity: 'low',
          message: 'Type check suppressed.',
          path: ctx.path,
          line: index + 1,
          snippet: raw,
          remediation: 'Fix the annotation, or narrow the ignore to a specific error code.',
        }),
      );
    }

    // `: Any`, `-> Any`, `Dict[str, Any]`. Not a bare word match: `Any` as a
    // variable name is rare but `many` should never count.
    if (/(:\s*Any\b|->\s*Any\b|\[\s*[\w, ]*Any\s*\])/.test(raw)) {
      anyCount += 1;
      if (!firstAnyLine) firstAnyLine = index + 1;
    }
  });

  if (anyCount >= 3) {
    findings.push(
      makeFinding({
        rule: 'type-escapes.any',
        category: 'type-escapes',
        severity: anyCount >= 10 ? 'medium' : 'low',
        message: `\`Any\` used in ${anyCount} annotations in this file.`,
        path: ctx.path,
        line: firstAnyLine,
        snippet: ctx.lines[firstAnyLine - 1] ?? '',
        remediation:
          'Write the real type, or a Protocol. `Any` turns off the checker for everything downstream of it.',
      }),
    );
  }

  return findings;
}

function goErrorHandling(ctx: DetectorContext): Finding[] {
  const findings: Finding[] = [];

  ctx.lines.forEach((raw, index) => {
    const trimmed = raw.trim();

    if (/^if\s+err\s*!=\s*nil\s*\{\s*\}$/.test(trimmed)) {
      findings.push(
        makeFinding({
          rule: 'error-handling.empty-catch',
          category: 'error-handling',
          severity: 'high',
          message: 'Error checked and then ignored.',
          path: ctx.path,
          line: index + 1,
          snippet: raw,
          remediation: 'Return the error, wrap it with context, or explain the deliberate ignore.',
        }),
      );
    }

    if (/^_\s*=\s*err\b/.test(trimmed) || /^_,\s*_\s*=/.test(trimmed)) {
      findings.push(
        makeFinding({
          rule: 'error-handling.discarded-error',
          category: 'error-handling',
          severity: 'medium',
          message: 'Error assigned to the blank identifier.',
          path: ctx.path,
          line: index + 1,
          snippet: raw,
          remediation:
            'Handle it, or add a comment stating why this call cannot meaningfully fail.',
        }),
      );
    }
  });

  return findings;
}

function rustErrorHandling(ctx: DetectorContext): Finding[] {
  const findings: Finding[] = [];
  let unwraps = 0;
  let firstLine = 0;

  ctx.lines.forEach((raw, index) => {
    const count = (raw.match(/\.unwrap\(\)/g) ?? []).length;
    if (count > 0) {
      unwraps += count;
      if (!firstLine) firstLine = index + 1;
    }
  });

  if (unwraps >= 5) {
    findings.push(
      makeFinding({
        rule: 'error-handling.unwrap-density',
        category: 'error-handling',
        severity: unwraps >= 15 ? 'medium' : 'low',
        message: `\`.unwrap()\` called ${unwraps} times in this file.`,
        path: ctx.path,
        line: firstLine,
        snippet: ctx.lines[firstLine - 1] ?? '',
        remediation: 'Propagate with `?` and return a typed error, or use `expect` with a reason.',
      }),
    );
  }

  return findings;
}

function structure(ctx: DetectorContext): Finding[] {
  const findings: Finding[] = [];
  const pattern = FUNCTION_START[ctx.language];

  if (pattern) {
    for (let i = 0; i < ctx.lines.length; i += 1) {
      const raw = ctx.lines[i]!;
      const match = pattern.exec(raw);
      if (!match) continue;

      const name = match[2] ?? match[1] ?? '<anonymous>';
      const end = blockExtent(ctx.lines, i);
      const length = end - i + 1;

      if (length > MAX_FUNCTION_LINES) {
        findings.push(
          makeFinding({
            rule: 'structure.long-function',
            category: 'structure',
            severity: length > MAX_FUNCTION_LINES * 2 ? 'medium' : 'low',
            message: `Function "${name}" is ${length} lines.`,
            path: ctx.path,
            line: i + 1,
            endLine: end + 1,
            snippet: raw,
            remediation: 'Split it. Each extracted piece should be nameable in three words.',
          }),
        );
      }

      const baseIndent = indentOf(raw);
      let deepest = 0;
      for (let j = i + 1; j <= end; j += 1) {
        const line = ctx.lines[j]!;
        if (!line.trim()) continue;
        deepest = Math.max(deepest, indentOf(line) - baseIndent);
      }
      // Assume four-space (or one-tab) steps; this is a smell check, not a metric.
      const nesting = Math.floor(deepest / 4);
      if (nesting > MAX_NESTING) {
        findings.push(
          makeFinding({
            rule: 'structure.deep-nesting',
            category: 'structure',
            severity: 'low',
            message: `Function "${name}" nests roughly ${nesting} levels deep.`,
            path: ctx.path,
            line: i + 1,
            snippet: raw,
            remediation: 'Invert the conditions and return early.',
          }),
        );
      }
    }
  }

  if (!isTestPath(ctx.path) && ctx.stats.lines > MAX_FILE_LINES) {
    findings.push(
      makeFinding({
        rule: 'structure.god-file',
        category: 'structure',
        severity: ctx.stats.lines > MAX_FILE_LINES * 2 ? 'medium' : 'low',
        message: `File is ${ctx.stats.lines} lines.`,
        path: ctx.path,
        line: 1,
        snippet: `${ctx.stats.lines} lines`,
        remediation: 'Split along the seams that already exist in the public surface.',
      }),
    );
  }

  return findings;
}

/**
 * Everything the TypeScript AST cannot see. Line-oriented and deliberately
 * conservative: a false positive here costs more trust than a missed finding.
 */
export const genericDetector: Detector = {
  id: 'generic',
  category: 'error-handling',
  // The TS AST detector already covers the JS family with far better precision.
  supports: (ctx) => !isJsFamily(ctx.language),
  run(ctx): Finding[] {
    const findings: Finding[] = [...structure(ctx)];

    switch (ctx.language) {
      case 'python':
        findings.push(...pythonErrorHandling(ctx), ...pythonTypeEscapes(ctx));
        break;
      case 'go':
        findings.push(...goErrorHandling(ctx));
        break;
      case 'rust':
        findings.push(...rustErrorHandling(ctx));
        break;
      default:
        break;
    }

    return isTestPath(ctx.path)
      ? findings.filter((f) => !f.rule.startsWith('structure.'))
      : findings;
  },
};
