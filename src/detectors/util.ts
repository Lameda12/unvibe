import type { Category, Finding, Language, Severity } from '../types.js';

export interface FindingInit {
  rule: string;
  category: Category;
  severity: Severity;
  message: string;
  path: string;
  line: number;
  endLine?: number;
  snippet: string;
  remediation: string;
  autofixable?: boolean;
}

const MAX_SNIPPET = 160;

export function makeFinding(init: FindingInit): Finding {
  const snippet = init.snippet.trim();
  return {
    rule: init.rule,
    category: init.category,
    severity: init.severity,
    message: init.message,
    path: init.path,
    line: init.line,
    endLine: init.endLine ?? init.line,
    snippet: snippet.length > MAX_SNIPPET ? `${snippet.slice(0, MAX_SNIPPET - 1)}…` : snippet,
    remediation: init.remediation,
    autofixable: init.autofixable ?? false,
  };
}

export const JS_LANGUAGES: Language[] = ['typescript', 'javascript'];

export function isJsFamily(language: Language): boolean {
  return language === 'typescript' || language === 'javascript';
}

export function isTestPath(filePath: string): boolean {
  return (
    /(^|\/)(tests?|__tests__|__mocks__|spec|e2e|fixtures?)\//i.test(filePath) ||
    /\.(test|spec)\.\w+$/i.test(filePath) ||
    /(^|\/)conftest\.py$/i.test(filePath) ||
    /(^|\/)test_\w+\.py$/i.test(filePath)
  );
}

/**
 * Sample code shipped for readers, not for production. Placeholder hosts and
 * fake keys are the point of an example, so most rules should stay out.
 */
export function isExamplePath(filePath: string): boolean {
  return /(^|\/)(examples?|samples?|demos?|docs?|benchmarks?)\//i.test(filePath);
}

/**
 * True when the line sits inside a `/** ... *\/` block. JSDoc is API reference
 * documentation: "Check if `setting` is enabled" is its job, not narration.
 */
export function jsDocLines(lines: string[]): Set<number> {
  const inside = new Set<number>();
  let open = false;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith('/**')) {
      open = !line.includes('*/');
      inside.add(index);
      return;
    }
    if (open) {
      inside.add(index);
      if (line.includes('*/')) open = false;
    }
  });

  return inside;
}

/**
 * `raise NotImplementedError` is how Python spells an abstract method. It is a
 * stub only when nothing marks it as one: no `@abstractmethod`, no ABC base, no
 * docstring saying subclasses must override.
 */
export function pythonAbstractLines(lines: string[]): Set<number> {
  const abstract = new Set<number>();
  let classIsAbstract = false;

  lines.forEach((raw, index) => {
    const line = raw.trim();

    const classMatch = /^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/.exec(line);
    if (classMatch) {
      const name = classMatch[1] ?? '';
      const bases = classMatch[2] ?? '';
      classIsAbstract =
        /\b(ABC|ABCMeta|Protocol)\b/.test(bases) ||
        /^(Base|Abstract)\w*/.test(name) ||
        /(Base|Mixin|Interface)$/.test(name);
      return;
    }

    if (!/raise\s+NotImplementedError/.test(line)) return;

    if (classIsAbstract) {
      abstract.add(index);
      return;
    }

    // Look back a few lines for a decorator or an overridable-method docstring.
    for (let i = Math.max(0, index - 6); i < index; i += 1) {
      const above = (lines[i] ?? '').trim();
      if (
        /@abstract(method|property)/.test(above) ||
        /must\s+(be\s+)?(override|implement)/i.test(above)
      ) {
        abstract.add(index);
        return;
      }
    }
  });

  return abstract;
}

const LICENSE_KEYWORDS =
  /\b(copyright|licen[cs]ed?|SPDX-License-Identifier|all rights reserved|MIT License|Apache License|GNU General Public)\b/i;

const PY_DOC_QUOTE = '"'.repeat(3);

/**
 * Line indices belonging to a leading licence or copyright header.
 *
 * Nearly every file in a large repo opens with one, and the rule-of-dashes
 * style most of them use is indistinguishable from a decorative banner. VS Code
 * alone produced 24,000 findings from its MIT header before this existed.
 */
export function licenseHeaderLines(lines: string[]): Set<number> {
  const header = new Set<number>();
  const block: number[] = [];
  let sawKeyword = false;
  let inBlockComment = false;

  for (let i = 0; i < Math.min(lines.length, 30); i += 1) {
    const line = (lines[i] ?? '').trim();

    // Shebangs and encoding pragmas sit above the header without ending it.
    if (!line || line.startsWith('#!') || /coding[:=]/.test(line)) continue;

    const opensBlock = line.startsWith('/*');
    const closesBlock = line.includes('*/');
    const isComment =
      inBlockComment ||
      opensBlock ||
      line.startsWith('//') ||
      line.startsWith('*') ||
      line.startsWith('#') ||
      line.startsWith(PY_DOC_QUOTE) ||
      line.startsWith('--');

    if (!isComment) break; // The first real code ends the header region.

    block.push(i);
    if (LICENSE_KEYWORDS.test(line)) sawKeyword = true;

    if (opensBlock && !closesBlock) inBlockComment = true;
    else if (closesBlock) inBlockComment = false;
  }

  if (sawKeyword) for (const index of block) header.add(index);
  return header;
}

/**
 * Replace the contents of string and template literals with spaces, preserving
 * length and line structure. Detectors that hunt for keywords must not fire on
 * a keyword that happens to live inside a message string.
 */
export function blankStrings(source: string): string {
  const out = source.split('');
  let i = 0;
  let quote: string | null = null;

  const blank = (at: number): void => {
    if (source[at] !== '\n') out[at] = ' ';
  };

  while (i < source.length) {
    const ch = source[i]!;

    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      else blank(i);
      i += 1;
      continue;
    }

    // Comments must be skipped, not scanned. An apostrophe in "doesn't" would
    // otherwise open a string that runs to the end of the file and blanks
    // everything after it, including the assertions we came here to find.
    if (ch === '#' || (ch === '/' && source[i + 1] === '/')) {
      while (i < source.length && source[i] !== '\n') {
        blank(i);
        i += 1;
      }
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        blank(i);
        i += 1;
      }
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }

    i += 1;
  }

  return out.join('');
}

/** Leading whitespace width, tabs counted as one. */
export function indentOf(line: string): number {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0].length : 0;
}

/**
 * Walk forward from a block-opening line to the last line that still belongs to
 * it. We only ever use this to bound a region, never to parse one.
 *
 * Indentation alone is not enough for brace languages: a multi-line template
 * literal or a chained call can sit at column zero inside a deeply indented
 * block, which would end the region early. Count braces when the opening line
 * has one, and fall back to indentation otherwise.
 */
export function blockExtent(lines: string[], startIndex: number): number {
  // A signature can wrap: `def f(\n  self, url\n):`. The closing line carries
  // the block opener, so measure from there or the body is missed entirely.
  const opener = signatureEnd(lines, startIndex);
  const start = lines[opener] ?? '';
  startIndex = opener;
  if (start.includes('{')) {
    const braced = braceExtent(lines, startIndex);
    if (braced !== null) return braced;
  }

  const baseIndent = indentOf(start);
  let end = startIndex;

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (indentOf(line) <= baseIndent) break;
    end = i;
  }

  return end;
}

/**
 * Advance past a parameter list that wraps across lines, returning the index of
 * the line where it closes. Returns the input unchanged when it is balanced.
 */
function signatureEnd(lines: string[], startIndex: number): number {
  let depth = 0;

  for (let i = startIndex; i < Math.min(lines.length, startIndex + 20); i += 1) {
    for (const char of stripInlineNoise(lines[i]!)) {
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
    }
    if (depth <= 0) return i;
  }

  return startIndex;
}

/**
 * Balance braces from the opening line to the line that closes it. Returns null
 * when the braces never balance, which means the source is unparseable here and
 * the caller should fall back to indentation rather than run to end of file.
 */
function braceExtent(lines: string[], startIndex: number): number | null {
  let depth = 0;
  let opened = false;

  for (let i = startIndex; i < lines.length; i += 1) {
    // Strings and comments hold braces that do not nest.
    const line = stripInlineNoise(lines[i]!);

    for (const char of line) {
      if (char === '{') {
        depth += 1;
        opened = true;
      } else if (char === '}') {
        depth -= 1;
      }
    }

    if (opened && depth <= 0) return i;
  }

  return null;
}

/** Blank out string, template and comment content so their braces do not count. */
function stripInlineNoise(line: string): string {
  return line
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""')
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '');
}

/** Strip comment markers and punctuation so comment text can be compared to code. */
export function commentText(line: string): string {
  return line
    .replace(/^\s*(\/\/+|#+|\/\*+|\*+\/?|--)/, '')
    .replace(/\*\/\s*$/, '')
    .trim();
}

export function isCommentLine(line: string, language: Language): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return true;
  if (
    (language === 'python' || language === 'ruby' || language === 'shell') &&
    trimmed.startsWith('#')
  ) {
    return true;
  }
  return false;
}

/** Identifiers in a line, lowercased, split on camelCase and snake_case. */
export function identifierWords(line: string): Set<string> {
  const words = new Set<string>();
  for (const token of line.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    for (const part of token.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_\s]+/)) {
      const word = part.toLowerCase();
      if (word.length > 2) words.add(word);
    }
  }
  return words;
}
