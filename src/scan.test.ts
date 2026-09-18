import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseConfig } from './config.js';
import { renderPlan, buildWaves } from './plan.js';
import { renderJson, renderMarkdown, renderSarif, renderTerminal } from './report/index.js';
import { scan } from './scan.js';
import type { ScanReport } from './types.js';

const SLOPPY = `import { unused } from './nowhere';

// ===============================================
// Step 1: fetch the user
// ===============================================
export async function fetchUser(id: any) {
  try {
    return await api.get(id);
  } catch (e) {
    console.error(e);
  }
}

// TODO(claude): implement the retry path
export function notDone() {
  throw new Error('Not implemented');
}

const API_KEY = 'your-api-key-here';
`;

const CLEAN = `import { getUser } from './repo';

export async function loadProfile(id: string) {
  const user = await getUser(id);
  if (!user) throw new NotFoundError(id);
  return { id: user.id, name: user.displayName };
}
`;

describe('scan', () => {
  let dir: string;
  let report: ScanReport;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'unvibe-scan-'));
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'sloppy.ts'), SLOPPY, 'utf8');
    await writeFile(path.join(dir, 'src', 'clean.ts'), CLEAN, 'utf8');

    report = await scan(
      { input: dir, root: dir, kind: 'local', ephemeral: false },
      { skipGit: true },
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds the seeded problems', () => {
    const rules = new Set(report.findings.map((f) => f.rule));
    expect(rules).toContain('placeholders.not-implemented');
    expect(rules).toContain('placeholders.fake-credential');
    expect(rules).toContain('placeholders.attributed-todo');
    expect(rules).toContain('error-handling.log-and-continue');
    expect(rules).toContain('dead-code.unused-import');
    expect(rules).toContain('comments.banner');
  });

  it('leaves the clean file alone', () => {
    expect(report.findings.filter((f) => f.path.endsWith('clean.ts'))).toHaveLength(0);
  });

  it('ranks the sloppy file as the top hotspot', () => {
    expect(report.score.hotspots[0]?.path).toBe('src/sloppy.ts');
  });

  it('sorts findings by severity', () => {
    const order = { high: 0, medium: 1, low: 2, info: 3 } as const;
    const ranks = report.findings.map((f) => order[f.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('scores it badly', () => {
    expect(report.score.slop).toBeGreaterThan(20);
    expect(['C', 'D', 'F']).toContain(report.score.grade);
  });

  it('honours an exact rule ignore', async () => {
    const filtered = await scan(
      { input: dir, root: dir, kind: 'local', ephemeral: false },
      { skipGit: true, ignoreRules: ['placeholders.fake-credential'] },
    );
    expect(filtered.findings.map((f) => f.rule)).not.toContain('placeholders.fake-credential');
  });

  it('honours a category wildcard ignore', async () => {
    const filtered = await scan(
      { input: dir, root: dir, kind: 'local', ephemeral: false },
      { skipGit: true, ignoreRules: ['placeholders.*'] },
    );
    expect(filtered.findings.filter((f) => f.category === 'placeholders')).toHaveLength(0);
  });

  it('records which files it read', () => {
    expect(report.files.map((f) => f.path).sort()).toEqual(['src/clean.ts', 'src/sloppy.ts']);
  });

  describe('reporters', () => {
    it('emits parseable JSON', () => {
      expect(() => JSON.parse(renderJson(report))).not.toThrow();
    });

    it('emits SARIF with a rule entry for every result', () => {
      const sarif = JSON.parse(renderSarif(report));
      const run = sarif.runs[0];
      expect(sarif.version).toBe('2.1.0');
      expect(run.tool.driver.name).toBe('unvibe');

      const ruleIds = new Set(run.tool.driver.rules.map((r: { id: string }) => r.id));
      for (const result of run.results) {
        expect(ruleIds).toContain(result.ruleId);
        expect(result.locations[0].physicalLocation.region.startLine).toBeGreaterThan(0);
      }
    });

    it('emits markdown with the grade in it', () => {
      expect(renderMarkdown(report)).toContain(`**${report.score.grade}**`);
    });

    it('emits terminal output without throwing', () => {
      expect(renderTerminal(report)).toContain('unvibe');
    });
  });

  describe('plan', () => {
    it('orders correctness before cosmetics', () => {
      const waves = buildWaves(report.findings);
      const titles = waves.map((w) => w.title);
      const correctness = titles.indexOf('Correctness and honesty');
      const noise = titles.indexOf('Noise removal');
      expect(correctness).toBeGreaterThanOrEqual(0);
      if (noise >= 0) expect(correctness).toBeLessThan(noise);
    });

    it('never puts a history finding in a wave', () => {
      const waves = buildWaves(report.findings);
      const categories = waves.flatMap((w) => w.findings.map((f) => f.category));
      expect(categories).not.toContain('history');
    });

    it('renders a plan that names the hotspot', () => {
      expect(renderPlan(report)).toContain('src/sloppy.ts');
    });
  });
});

describe('parseConfig', () => {
  it('accepts a valid config', () => {
    expect(parseConfig({ ignoreRules: ['comments.*'], maxSlop: 40 }, 'x')).toEqual({
      ignoreRules: ['comments.*'],
      maxSlop: 40,
    });
  });

  it('rejects an unknown key rather than silently ignoring it', () => {
    expect(() => parseConfig({ ignoreRule: ['x'] }, 'x')).toThrow(/unknown key/);
  });

  it('rejects a wrong type', () => {
    expect(() => parseConfig({ ignoreRules: 'comments.*' }, 'x')).toThrow(/array of strings/);
  });

  it('rejects an invalid severity', () => {
    expect(() => parseConfig({ minSeverity: 'critical' }, 'x')).toThrow(/minSeverity/);
  });

  it('rejects a non-object', () => {
    expect(() => parseConfig([], 'x')).toThrow(/JSON object/);
  });
});
