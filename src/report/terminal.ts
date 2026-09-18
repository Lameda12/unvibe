import type { Finding, Grade, ScanReport, Severity } from '../types.js';

const SUPPORTS_COLOR =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  (process.stdout.isTTY === true || process.env.FORCE_COLOR !== undefined);

const CODES = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  red: '[31m',
  yellow: '[33m',
  blue: '[34m',
  green: '[32m',
  magenta: '[35m',
  grey: '[90m',
} as const;

type Color = keyof typeof CODES;

function paint(text: string, ...colors: Color[]): string {
  if (!SUPPORTS_COLOR) return text;
  return `${colors.map((c) => CODES[c]).join('')}${text}${CODES.reset}`;
}

const SEVERITY_COLOR: Record<Severity, Color> = {
  high: 'red',
  medium: 'yellow',
  low: 'blue',
  info: 'grey',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'high',
  medium: 'med ',
  low: 'low ',
  info: 'info',
};

const GRADE_COLOR: Record<Grade, Color> = {
  A: 'green',
  B: 'green',
  C: 'yellow',
  D: 'red',
  F: 'red',
};

const VERDICT: Record<Grade, string> = {
  A: 'Reads like someone owns it.',
  B: 'Normal wear. Worth a pass, not an emergency.',
  C: 'Recognisably generated in places. Budget a cleanup sprint.',
  D: 'Substantially unreviewed. Read before you trust it.',
  F: 'Do not ship this without a full read-through.',
};

function bar(value: number, width = 28): string {
  const filled = Math.round((Math.min(100, Math.max(0, value)) / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function groupByFile(findings: Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const bucket = grouped.get(finding.path);
    if (bucket) bucket.push(finding);
    else grouped.set(finding.path, [finding]);
  }
  return grouped;
}

export interface TerminalOptions {
  /** Show every finding rather than the worst ones per file. */
  verbose?: boolean;
  maxFilesShown?: number;
  maxPerFile?: number;
}

export function renderTerminal(report: ScanReport, options: TerminalOptions = {}): string {
  const { score, findings, files } = report;
  const maxFiles = options.verbose ? Number.POSITIVE_INFINITY : (options.maxFilesShown ?? 12);
  const maxPerFile = options.verbose ? Number.POSITIVE_INFINITY : (options.maxPerFile ?? 5);

  const codeLines = files.reduce((sum, f) => sum + f.codeLines, 0);
  const out: string[] = [''];

  const label = report.target.remoteUrl ?? report.target.input;
  out.push(paint(`  unvibe  ${label}`, 'bold'));
  out.push(
    paint(
      `  ${files.length} files, ${codeLines.toLocaleString()} code lines, scanned in ${(report.durationMs / 1000).toFixed(1)}s`,
      'grey',
    ),
  );
  out.push('');

  const gradeColor = GRADE_COLOR[score.grade];
  out.push(
    `  ${paint(bar(score.slop), gradeColor)}  ${paint(`${score.slop}`, 'bold', gradeColor)}${paint('/100 slop', 'grey')}  ${paint(`grade ${score.grade}`, 'bold', gradeColor)}`,
  );
  out.push(`  ${paint(VERDICT[score.grade], 'grey')}`);
  out.push('');

  if (score.byCategory.length > 0) {
    out.push(paint('  BY CATEGORY', 'bold'));
    const widest = Math.max(...score.byCategory.map((c) => c.category.length));
    for (const category of score.byCategory) {
      const name = category.category.padEnd(widest);
      const count = String(category.findings).padStart(4);
      out.push(
        `    ${name}  ${paint(count, 'bold')} findings  ${paint(`${category.perKloc}/kloc`, 'grey')}`,
      );
    }
    out.push('');
  }

  if (findings.length === 0) {
    out.push(
      paint(
        '  Nothing found. Either it is clean or the detectors do not cover this stack.',
        'green',
      ),
    );
    out.push('');
    return out.join('\n');
  }

  out.push(paint('  FINDINGS', 'bold'));
  out.push('');

  const grouped = groupByFile(findings);
  // Report files in hotspot order so the worst offenders are read first.
  const order = new Map(report.score.hotspots.map((h, i) => [h.path, i]));
  const paths = [...grouped.keys()].sort(
    (a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b),
  );

  let shownFiles = 0;
  for (const path of paths) {
    if (shownFiles >= maxFiles) break;
    shownFiles += 1;

    const fileFindings = grouped.get(path)!;
    out.push(`  ${paint(path, 'bold', 'magenta')} ${paint(`(${fileFindings.length})`, 'grey')}`);

    for (const finding of fileFindings.slice(0, maxPerFile)) {
      const severity = paint(SEVERITY_LABEL[finding.severity], SEVERITY_COLOR[finding.severity]);
      const location = paint(`:${finding.line}`, 'grey');
      out.push(`    ${severity} ${location.padEnd(6)} ${finding.message}`);
      out.push(`         ${paint(finding.rule, 'grey')}`);
    }

    if (fileFindings.length > maxPerFile) {
      out.push(paint(`         +${fileFindings.length - maxPerFile} more`, 'grey'));
    }
    out.push('');
  }

  if (paths.length > shownFiles) {
    out.push(
      paint(
        `  +${paths.length - shownFiles} more files with findings. Use --verbose to see them all.`,
        'grey',
      ),
    );
    out.push('');
  }

  if (report.git.available && report.git.notes.length > 0) {
    for (const note of report.git.notes) out.push(paint(`  ${note}`, 'grey'));
    out.push('');
  }

  out.push(
    paint(
      '  Next: unvibe plan <target> > UNVIBE.md, or run the unvibe skill in your agent.',
      'grey',
    ),
  );
  out.push('');

  return out.join('\n');
}
