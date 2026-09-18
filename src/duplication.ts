import { createHash } from 'node:crypto';

import { isTestPath, makeFinding } from './detectors/util.js';
import type { Finding, Language } from './types.js';
import type { SourceFile } from './walk.js';

/** Consecutive normalized lines that must match before we call it a clone. */
const WINDOW = 8;
/** Lines shorter than this carry no structure worth matching. */
const MIN_LINE_CHARS = 4;
/**
 * Distinct normalized lines a window must contain. A rule table or a switch of
 * near-identical cases repeats its own shape by design; without this, every
 * lookup table in the codebase reads as a clone family.
 */
const MIN_DISTINCT_LINES = 5;

export interface DuplicationOptions {
  window?: number;
  /** Ignore clones repeated fewer times than this. */
  minOccurrences?: number;
  minDistinctLines?: number;
}

interface Occurrence {
  path: string;
  startLine: number;
  endLine: number;
}

const COMMENT_PREFIX = /^\s*(\/\/|#|\*|--)/;

/**
 * Reduce a line to its shape. Whitespace normalizes and numeric literals
 * collapse, but string literals are preserved: blanking them makes every
 * configuration table in a codebase look like a copy of every other one.
 */
function normalizeLine(line: string): string | null {
  if (COMMENT_PREFIX.test(line)) return null;

  const normalized = line
    .replace(/\b\d+(?:\.\d+)?\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length < MIN_LINE_CHARS) return null;
  // Lone punctuation: closing braces, `});`, `end`.
  if (/^[\s)}\];,]*$/.test(normalized)) return null;

  return normalized;
}

function hashWindow(parts: string[]): string {
  return createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16);
}

function languageGroup(language: Language): string {
  if (language === 'typescript' || language === 'javascript') return 'js';
  if (language === 'c' || language === 'cpp') return 'c';
  return language;
}

/** Tracks which line ranges have already been attributed to a clone family. */
class ClaimedRegions {
  private readonly byPath = new Map<string, Array<[number, number]>>();

  overlaps(occurrence: Occurrence): boolean {
    const ranges = this.byPath.get(occurrence.path);
    if (!ranges) return false;
    return ranges.some(
      ([start, end]) => occurrence.startLine <= end && occurrence.endLine >= start,
    );
  }

  claim(occurrence: Occurrence): void {
    const ranges = this.byPath.get(occurrence.path);
    const range: [number, number] = [occurrence.startLine, occurrence.endLine];
    if (ranges) ranges.push(range);
    else this.byPath.set(occurrence.path, [range]);
  }
}

/**
 * Cross-file clone detection. Duplication is the single most reliable signal of
 * generated code: a model asked for a third endpoint reproduces the first two
 * rather than factoring out what they share.
 *
 * A sliding window produces one hit per offset, so a single 30-line clone would
 * otherwise report 23 times. Families are consumed worst-first and every line
 * they cover is claimed, which leaves exactly one finding per clone site.
 */
export function findDuplication(files: SourceFile[], options: DuplicationOptions = {}): Finding[] {
  const window = options.window ?? WINDOW;
  const minOccurrences = options.minOccurrences ?? 2;
  const minDistinct = options.minDistinctLines ?? MIN_DISTINCT_LINES;

  // Keyed by language group so a JS block never matches a Python block.
  const index = new Map<string, Occurrence[]>();

  for (const file of files) {
    const group = languageGroup(file.stats.language);
    const rawLines = file.source.split('\n');

    const normalized: Array<{ text: string; line: number }> = [];
    rawLines.forEach((raw, i) => {
      const text = normalizeLine(raw);
      if (text !== null) normalized.push({ text, line: i + 1 });
    });

    for (let i = 0; i + window <= normalized.length; i += 1) {
      const slice = normalized.slice(i, i + window);
      const texts = slice.map((entry) => entry.text);

      if (new Set(texts).size < minDistinct) continue;

      const key = `${group}:${hashWindow(texts)}`;
      const occurrence: Occurrence = {
        path: file.stats.path,
        startLine: slice[0]!.line,
        endLine: slice[slice.length - 1]!.line,
      };

      const bucket = index.get(key);
      if (bucket) bucket.push(occurrence);
      else index.set(key, [occurrence]);
    }
  }

  const families = [...index.values()]
    .filter((occurrences) => occurrences.length >= minOccurrences)
    // Biggest families first: they are the most worth extracting, and they get
    // to claim their lines before smaller overlapping ones do.
    .sort((a, b) => b.length - a.length || a[0]!.startLine - b[0]!.startLine);

  const claimed = new ClaimedRegions();
  const findings: Finding[] = [];

  for (const occurrences of families) {
    const fresh = occurrences.filter((occurrence) => !claimed.overlaps(occurrence));
    if (fresh.length < minOccurrences) continue;

    for (const occurrence of fresh) claimed.claim(occurrence);

    const primary = fresh[0]!;
    const distinctFiles = new Set(fresh.map((o) => o.path)).size;
    const spanned = primary.endLine - primary.startLine + 1;
    // Many teams deliberately repeat test setup rather than share a fixture,
    // because a readable test beats a DRY one. Note it, do not penalize it.
    const allInTests = fresh.every((o) => isTestPath(o.path));

    const others = fresh
      .slice(1, 4)
      .map((o) => `${o.path}:${o.startLine}`)
      .join(', ');
    const extra = fresh.length > 4 ? ` and ${fresh.length - 4} more` : '';

    findings.push(
      makeFinding({
        rule: distinctFiles > 1 ? 'duplication.cross-file' : 'duplication.within-file',
        category: 'duplication',
        severity: allInTests
          ? 'info'
          : fresh.length >= 4 || spanned >= window * 2
            ? 'medium'
            : 'low',
        message: `${spanned} lines duplicated across ${fresh.length} locations.`,
        path: primary.path,
        line: primary.startLine,
        endLine: primary.endLine,
        snippet: `also at ${others}${extra}`,
        remediation:
          'Extract the shared block. If the copies have drifted, reconcile them first: divergent clones are where bugs get fixed in one place and not the others.',
      }),
    );
  }

  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}
