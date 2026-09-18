import type { Category, Finding, ScanReport } from './types.js';

export interface Wave {
  id: number;
  title: string;
  rationale: string;
  findings: Finding[];
}

interface WaveSpec {
  title: string;
  rationale: string;
  /** Returns true when a finding belongs in this wave. First match wins. */
  matches: (finding: Finding) => boolean;
}

const RISK_CATEGORIES = new Set<Category>(['error-handling', 'placeholders', 'test-theater']);

/**
 * Order matters. Fixing noise first makes the diff enormous and buries the
 * changes that actually alter behaviour, so correctness leads and cosmetics
 * land last, after the structure they would otherwise have to be reapplied to.
 */
const WAVE_SPECS: WaveSpec[] = [
  {
    title: 'Correctness and honesty',
    rationale:
      'These change what the program does under failure, or admit it does not do what it claims. Nothing else is worth doing until they are resolved, and each one needs a test that fails before the fix.',
    matches: (f) =>
      RISK_CATEGORIES.has(f.category) && (f.severity === 'high' || f.severity === 'medium'),
  },
  {
    title: 'Structure and duplication',
    rationale:
      'Collapse the copies and split the god objects. Do this before cosmetic cleanup so the cleanup is not applied three times to three clones, and keep each extraction behaviour-preserving with the tests green between steps.',
    matches: (f) => f.category === 'duplication' || f.category === 'structure',
  },
  {
    title: 'Type safety',
    rationale:
      'Close the type holes now that the shapes have stopped moving. Work outside-in: fix the boundary types first and let the inferred types downstream fall out.',
    matches: (f) => f.category === 'type-escapes' || f.category === 'dead-code',
  },
  {
    title: 'Noise removal',
    rationale:
      'Purely textual. Safe to batch into one commit, and safe to skip entirely if you are short on time.',
    matches: () => true,
  },
];

export function buildWaves(findings: Finding[]): Wave[] {
  const buckets: Finding[][] = WAVE_SPECS.map(() => []);

  for (const finding of findings) {
    // History findings describe the repo, not a code change to make.
    if (finding.category === 'history') continue;

    const index = WAVE_SPECS.findIndex((spec) => spec.matches(finding));
    buckets[index === -1 ? WAVE_SPECS.length - 1 : index]!.push(finding);
  }

  return WAVE_SPECS.map((spec, index) => ({
    id: index + 1,
    title: spec.title,
    rationale: spec.rationale,
    findings: buckets[index]!,
  })).filter((wave) => wave.findings.length > 0);
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

/** Files carrying the most weight, so a partial cleanup still moves the score. */
function priorityFiles(report: ScanReport, limit = 8): string[] {
  return report.score.hotspots.slice(0, limit).map((h) => h.path);
}

export interface PlanOptions {
  /** Cap the findings listed per wave so the plan stays readable. */
  maxPerWave?: number;
}

export function renderPlan(report: ScanReport, options: PlanOptions = {}): string {
  const maxPerWave = options.maxPerWave ?? 40;
  const waves = buildWaves(report.findings);
  const { score, target } = report;
  const totalLines = report.files.reduce((sum, f) => sum + f.codeLines, 0);

  const out: string[] = [];

  out.push(`# Unvibe plan: ${target.remoteUrl ?? target.input}`);
  out.push('');
  out.push(
    `Grade **${score.grade}** (slop ${score.slop}/100) across ${report.files.length} files and ${totalLines.toLocaleString()} code lines. ` +
      `${report.findings.length} findings, weighted density ${score.weightPerKloc} per 1000 lines.`,
  );
  out.push('');

  if (report.git.available) {
    out.push(
      `History: ${report.git.commits} commits, ${report.git.bulkCommits} of them touching 25+ files. ` +
        (report.git.churnedFiles.length > 0
          ? `${report.git.churnedFiles.length} files churned heavily right after being added.`
          : 'No significant early churn.'),
    );
    out.push('');
  }

  out.push('## Where to start');
  out.push('');
  const priority = priorityFiles(report);
  if (priority.length === 0) {
    out.push('No hotspots. The findings are spread thin across the codebase.');
  } else {
    out.push('These files carry the most weight. Fixing them moves the score the most:');
    out.push('');
    for (const path of priority) {
      const hotspot = report.score.hotspots.find((h) => h.path === path)!;
      out.push(`- \`${path}\` — ${hotspot.findings} findings, ${hotspot.perKloc}/kloc`);
    }
  }
  out.push('');

  out.push('## Rules of engagement');
  out.push('');
  out.push('- One wave per branch. Do not mix behaviour changes with cosmetic ones.');
  out.push(
    '- Before changing error handling, write the test that proves the current behaviour is wrong.',
  );
  out.push("- Run the project's own test and lint commands between waves, not just at the end.");
  out.push(
    '- If a finding is wrong, say so and move on. The detectors are heuristics, not an oracle.',
  );
  out.push('');

  for (const wave of waves) {
    out.push(`## Wave ${wave.id}: ${wave.title}`);
    out.push('');
    out.push(wave.rationale);
    out.push('');

    const shown = wave.findings.slice(0, maxPerWave);
    const grouped = groupByFile(shown);

    for (const [path, findings] of grouped) {
      out.push(`### \`${path}\``);
      out.push('');
      for (const finding of findings) {
        out.push(`- **L${finding.line}** ${finding.message} \`[${finding.rule}]\``);
        out.push(`  - ${finding.remediation}`);
      }
      out.push('');
    }

    if (wave.findings.length > shown.length) {
      out.push(`_${wave.findings.length - shown.length} further findings in this wave omitted._`);
      out.push('');
    }
  }

  out.push('## Done when');
  out.push('');
  out.push('- Every wave-1 finding is either fixed or explicitly rejected in writing.');
  out.push('- `unvibe scan .` reports a lower slop score than the one at the top of this plan.');
  out.push('- The test suite passes, and at least one new test covers each behaviour change.');
  out.push('');

  return out.join('\n');
}
