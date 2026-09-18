import type { Finding, ScanReport, Severity } from '../types.js';
import { renderTerminal, type TerminalOptions } from './terminal.js';

export { renderTerminal, type TerminalOptions };

export type Format = 'terminal' | 'json' | 'markdown' | 'sarif';

export function renderJson(report: ScanReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function severityRank(severity: Severity): number {
  return { high: 0, medium: 1, low: 2, info: 3 }[severity];
}

export function renderMarkdown(report: ScanReport): string {
  const { score, findings, files } = report;
  const codeLines = files.reduce((sum, f) => sum + f.codeLines, 0);
  const out: string[] = [];

  out.push(`# unvibe report: ${report.target.remoteUrl ?? report.target.input}`);
  out.push('');
  out.push(`| | |`);
  out.push(`|---|---|`);
  out.push(`| Grade | **${score.grade}** |`);
  out.push(`| Slop score | ${score.slop} / 100 |`);
  out.push(`| Findings | ${findings.length} |`);
  out.push(`| Weighted density | ${score.weightPerKloc} per 1000 code lines |`);
  out.push(`| Files scanned | ${files.length} |`);
  out.push(`| Code lines | ${codeLines.toLocaleString()} |`);
  out.push(`| Scanned at | ${report.generatedAt} |`);
  out.push('');

  if (score.byCategory.length > 0) {
    out.push('## By category');
    out.push('');
    out.push('| Category | Findings | Weight | Per kloc |');
    out.push('|---|---:|---:|---:|');
    for (const category of score.byCategory) {
      out.push(
        `| ${category.category} | ${category.findings} | ${category.weight} | ${category.perKloc} |`,
      );
    }
    out.push('');
  }

  if (score.hotspots.length > 0) {
    out.push('## Hotspots');
    out.push('');
    out.push('| File | Findings | Weight | Per kloc |');
    out.push('|---|---:|---:|---:|');
    for (const hotspot of score.hotspots.slice(0, 15)) {
      out.push(
        `| \`${hotspot.path}\` | ${hotspot.findings} | ${hotspot.weight} | ${hotspot.perKloc} |`,
      );
    }
    out.push('');
  }

  if (report.git.available) {
    out.push('## History signals');
    out.push('');
    out.push(`- ${report.git.commits} commits`);
    out.push(
      `- ${report.git.bulkCommits} bulk commits (25+ files); largest touched ${report.git.largestCommitFiles} files`,
    );
    out.push(`- ${report.git.churnedFiles.length} files churned heavily after being added`);
    out.push(`- ${report.git.generatedMessages} generic commit subjects`);
    out.push('');
  }

  out.push('## Findings');
  out.push('');

  const bySeverity = [...findings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
  const grouped = new Map<string, Finding[]>();
  for (const finding of bySeverity) {
    const bucket = grouped.get(finding.path);
    if (bucket) bucket.push(finding);
    else grouped.set(finding.path, [finding]);
  }

  for (const [path, fileFindings] of grouped) {
    out.push(`### \`${path}\``);
    out.push('');
    for (const finding of fileFindings) {
      out.push(
        `- \`${finding.severity}\` **L${finding.line}** ${finding.message} _(${finding.rule})_`,
      );
      out.push(`  - ${finding.remediation}`);
    }
    out.push('');
  }

  return out.join('\n');
}

const SARIF_LEVEL: Record<Severity, string> = {
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};

const SARIF_RANK: Record<Severity, number> = {
  high: 90,
  medium: 60,
  low: 30,
  info: 10,
};

/**
 * SARIF 2.1.0, which GitHub code scanning ingests directly. Every distinct rule
 * id in the run must appear in `rules`, so build that from the findings.
 */
export function renderSarif(report: ScanReport): string {
  const ruleIndex = new Map<string, number>();
  const rules: unknown[] = [];

  for (const finding of report.findings) {
    if (ruleIndex.has(finding.rule)) continue;
    ruleIndex.set(finding.rule, rules.length);
    rules.push({
      id: finding.rule,
      name: finding.rule.replace(/[.-](\w)/g, (_, c: string) => c.toUpperCase()),
      shortDescription: { text: finding.message },
      fullDescription: { text: finding.remediation },
      defaultConfiguration: { level: SARIF_LEVEL[finding.severity] },
      properties: { category: finding.category, tags: ['ai-slop', finding.category] },
    });
  }

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            version: report.tool.version,
            informationUri: 'https://github.com/Lameda12/unvibe',
            rules,
          },
        },
        results: report.findings.map((finding) => ({
          ruleId: finding.rule,
          ruleIndex: ruleIndex.get(finding.rule)!,
          level: SARIF_LEVEL[finding.severity],
          rank: SARIF_RANK[finding.severity],
          message: { text: `${finding.message} ${finding.remediation}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.path },
                region: {
                  startLine: finding.line,
                  endLine: Math.max(finding.line, finding.endLine),
                  snippet: { text: finding.snippet },
                },
              },
            },
          ],
        })),
      },
    ],
  };

  return `${JSON.stringify(sarif, null, 2)}\n`;
}

export function render(report: ScanReport, format: Format, options: TerminalOptions = {}): string {
  switch (format) {
    case 'json':
      return renderJson(report);
    case 'markdown':
      return renderMarkdown(report);
    case 'sarif':
      return renderSarif(report);
    case 'terminal':
    default:
      return renderTerminal(report, options);
  }
}
