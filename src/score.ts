import type {
  Category,
  CategoryScore,
  FileStats,
  Finding,
  Grade,
  Score,
  Severity,
} from './types.js';

/**
 * Weight each severity contributes to the slop total. A `high` finding is worth
 * twenty `info` findings, which keeps a long tail of nitpicks from drowning out
 * one genuinely broken error handler.
 */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0.25,
  low: 1,
  medium: 2.5,
  high: 5,
};

/**
 * Weighted findings per 1000 code lines that a healthy, human-maintained
 * codebase tends to carry. This is a calibration constant, not a law of nature:
 * it anchors the curve so that "normal open source" grades a B rather than an A.
 */
export const BASELINE_WEIGHT_PER_KLOC = 4;

/**
 * Chosen so that {@link BASELINE_WEIGHT_PER_KLOC} maps to a slop score of 20.
 * `100 * (1 - e^(-k * x))` gives a saturating curve: it stays sensitive in the
 * 0-25 range where real codebases live and flattens out past that, so a repo
 * that is 3x worse than terrible does not report a misleading 300.
 */
const SLOP_CURVE_K = -Math.log(0.8) / BASELINE_WEIGHT_PER_KLOC;

const GRADE_THRESHOLDS: Array<[number, Grade]> = [
  [20, 'A'],
  [35, 'B'],
  [50, 'C'],
  [70, 'D'],
];

export function gradeFor(slop: number): Grade {
  for (const [ceiling, grade] of GRADE_THRESHOLDS) {
    if (slop < ceiling) return grade;
  }
  return 'F';
}

export function slopFromDensity(weightPerKloc: number): number {
  const raw = 100 * (1 - Math.exp(-SLOP_CURVE_K * Math.max(0, weightPerKloc)));
  return Math.round(raw * 10) / 10;
}

export function weightOf(finding: Finding): number {
  return SEVERITY_WEIGHT[finding.severity];
}

function perKloc(weight: number, codeLines: number): number {
  if (codeLines <= 0) return 0;
  return Math.round((weight / codeLines) * 1000 * 100) / 100;
}

export function computeScore(findings: Finding[], files: FileStats[]): Score {
  const codeLines = files.reduce((sum, f) => sum + f.codeLines, 0);

  const categoryTotals = new Map<Category, { findings: number; weight: number }>();
  const fileTotals = new Map<string, { findings: number; weight: number }>();

  for (const finding of findings) {
    const w = weightOf(finding);

    const cat = categoryTotals.get(finding.category) ?? { findings: 0, weight: 0 };
    cat.findings += 1;
    cat.weight += w;
    categoryTotals.set(finding.category, cat);

    const file = fileTotals.get(finding.path) ?? { findings: 0, weight: 0 };
    file.findings += 1;
    file.weight += w;
    fileTotals.set(finding.path, file);
  }

  const totalWeight =
    Math.round([...categoryTotals.values()].reduce((s, c) => s + c.weight, 0) * 100) / 100;
  const weightPerKloc = perKloc(totalWeight, codeLines);

  const byCategory: CategoryScore[] = [...categoryTotals.entries()]
    .map(([category, totals]) => ({
      category,
      findings: totals.findings,
      weight: Math.round(totals.weight * 100) / 100,
      perKloc: perKloc(totals.weight, codeLines),
    }))
    .sort((a, b) => b.weight - a.weight);

  const linesByPath = new Map(files.map((f) => [f.path, f.codeLines]));
  const hotspots = [...fileTotals.entries()]
    .map(([path, totals]) => ({
      path,
      findings: totals.findings,
      weight: Math.round(totals.weight * 100) / 100,
      perKloc: perKloc(totals.weight, linesByPath.get(path) ?? 0),
    }))
    // Rank by absolute weight first so a 2000-line swamp outranks a noisy stub.
    .sort((a, b) => b.weight - a.weight || b.perKloc - a.perKloc)
    .slice(0, 25);

  const slop = slopFromDensity(weightPerKloc);

  return { slop, grade: gradeFor(slop), totalWeight, weightPerKloc, byCategory, hotspots };
}
