/**
 * Core domain types. Every detector speaks in {@link Finding}s; every reporter
 * consumes a {@link ScanReport}.
 */

export type Severity = 'info' | 'low' | 'medium' | 'high';

export type Category =
  | 'comments'
  | 'error-handling'
  | 'placeholders'
  | 'type-escapes'
  | 'structure'
  | 'dead-code'
  | 'duplication'
  | 'test-theater'
  | 'history';

export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'ruby'
  | 'php'
  | 'csharp'
  | 'c'
  | 'cpp'
  | 'shell'
  | 'other';

export interface Finding {
  /** Stable dotted id, e.g. `comments.narration`. Used for ignores and SARIF rule ids. */
  rule: string;
  category: Category;
  severity: Severity;
  /** One line, present tense, says what is wrong. */
  message: string;
  /** Repo-relative POSIX path. */
  path: string;
  /** 1-indexed. */
  line: number;
  endLine: number;
  /** The offending source line, trimmed and truncated. */
  snippet: string;
  /** What a human or agent should do about it. */
  remediation: string;
  /** True when `unvibe fix` can apply this mechanically without judgement. */
  autofixable: boolean;
}

export interface FileStats {
  path: string;
  language: Language;
  /** Total physical lines. */
  lines: number;
  /** Lines that are neither blank nor comment-only. */
  codeLines: number;
  commentLines: number;
  bytes: number;
}

export interface GitSignals {
  available: boolean;
  commits: number;
  /** Commits touching >= `bulkCommitFileThreshold` files. */
  bulkCommits: number;
  largestCommitFiles: number;
  /** Fraction of tracked lines introduced by bulk commits, 0..1. */
  bulkLineShare: number;
  /** Files rewritten in >= 3 commits within 7 days of first appearing. */
  churnedFiles: string[];
  /** Commit subjects that read as machine-written. */
  generatedMessages: number;
  notes: string[];
}

export interface CategoryScore {
  category: Category;
  findings: number;
  weight: number;
  /** Weighted findings per 1000 code lines. */
  perKloc: number;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface Score {
  /** 0 (clean) to 100 (drenched). Higher is worse. */
  slop: number;
  grade: Grade;
  totalWeight: number;
  weightPerKloc: number;
  byCategory: CategoryScore[];
  /** Files sorted by weighted density, worst first. */
  hotspots: Array<{ path: string; weight: number; findings: number; perKloc: number }>;
}

export interface ScanTarget {
  /** What the user typed. */
  input: string;
  /** Absolute path actually scanned. */
  root: string;
  kind: 'local' | 'remote';
  /** Set for remote targets. */
  remoteUrl?: string;
  ref?: string;
  /** Temp clones are removed after the scan unless `--keep-clone`. */
  ephemeral: boolean;
}

export interface ScanReport {
  target: ScanTarget;
  generatedAt: string;
  tool: { name: string; version: string };
  files: FileStats[];
  findings: Finding[];
  git: GitSignals;
  score: Score;
  durationMs: number;
}

export interface DetectorContext {
  path: string;
  language: Language;
  source: string;
  /** Pre-split source lines, 0-indexed. */
  lines: string[];
  stats: FileStats;
}

export interface Detector {
  id: string;
  category: Category;
  /** Return false to skip this file entirely. */
  supports(ctx: DetectorContext): boolean;
  run(ctx: DetectorContext): Finding[];
}
