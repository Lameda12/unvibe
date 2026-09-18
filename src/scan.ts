import { DETECTORS } from './detectors/index.js';
import { findDuplication } from './duplication.js';
import { collectGitSignals, gitFindings } from './git.js';
import { computeScore } from './score.js';
import type { DetectorContext, Finding, Language, ScanReport, ScanTarget } from './types.js';
import { collectFiles } from './walk.js';

export const VERSION = '0.1.0';

export interface ScanOptions {
  exclude?: string[];
  languages?: Language[];
  maxFiles?: number;
  /** Rule ids or `category.*` globs to drop from the report. */
  ignoreRules?: string[];
  skipGit?: boolean;
  skipDuplication?: boolean;
  onProgress?: (message: string) => void;
}

function ruleMatches(rule: string, pattern: string): boolean {
  if (pattern === rule) return true;
  if (pattern.endsWith('.*')) return rule.startsWith(pattern.slice(0, -1));
  return false;
}

function applyIgnores(findings: Finding[], ignoreRules: string[]): Finding[] {
  if (ignoreRules.length === 0) return findings;
  return findings.filter((finding) => !ignoreRules.some((p) => ruleMatches(finding.rule, p)));
}

function sortFindings(findings: Finding[]): Finding[] {
  const order = { high: 0, medium: 1, low: 2, info: 3 } as const;
  return [...findings].sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule),
  );
}

export async function scan(target: ScanTarget, options: ScanOptions = {}): Promise<ScanReport> {
  const started = Date.now();
  const progress = options.onProgress ?? (() => {});

  progress('Collecting files');
  const files = await collectFiles(target.root, {
    ...(options.exclude ? { exclude: options.exclude } : {}),
    ...(options.languages ? { languages: options.languages } : {}),
    ...(options.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {}),
  });

  progress(`Analyzing ${files.length} files`);
  const findings: Finding[] = [];

  for (const file of files) {
    const ctx: DetectorContext = {
      path: file.stats.path,
      language: file.stats.language,
      source: file.source,
      lines: file.source.split('\n'),
      stats: file.stats,
    };

    for (const detector of DETECTORS) {
      if (!detector.supports(ctx)) continue;
      try {
        findings.push(...detector.run(ctx));
      } catch (error) {
        // One bad file must not sink the scan. Surface it and keep going.
        progress(
          `Detector ${detector.id} failed on ${ctx.path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  if (!options.skipDuplication) {
    progress('Looking for duplicated blocks');
    findings.push(...findDuplication(files));
  }

  let git = {
    available: false,
    commits: 0,
    bulkCommits: 0,
    largestCommitFiles: 0,
    bulkLineShare: 0,
    churnedFiles: [] as string[],
    generatedMessages: 0,
    notes: ['History analysis skipped.'],
  };

  if (!options.skipGit) {
    progress('Reading git history');
    git = await collectGitSignals(target.root);
    findings.push(...gitFindings(git));
  }

  const kept = sortFindings(applyIgnores(findings, options.ignoreRules ?? []));
  const stats = files.map((f) => f.stats);

  return {
    target,
    generatedAt: new Date().toISOString(),
    tool: { name: 'unvibe', version: VERSION },
    files: stats,
    findings: kept,
    git,
    score: computeScore(kept, stats),
    durationMs: Date.now() - started,
  };
}
