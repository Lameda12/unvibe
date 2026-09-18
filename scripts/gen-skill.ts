/**
 * Writes the shipped skill files from their single source of truth in
 * `src/skill/content.ts`. Run with `--check` in CI to fail on drift.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULES_MD, SKILL_MD } from '../src/skill/content.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.join(root, 'skills', 'unvibe');

const outputs: Array<[string, string]> = [
  [path.join(skillDir, 'SKILL.md'), SKILL_MD],
  [path.join(skillDir, 'references', 'rules.md'), RULES_MD],
];

const check = process.argv.includes('--check');

let drifted = false;

await mkdir(path.join(skillDir, 'references'), { recursive: true });

for (const [target, content] of outputs) {
  if (check) {
    // A missing file is drift, same as a differing one.
    const current = await readFile(target, 'utf8').catch(() => null);
    if (current !== content) {
      drifted = true;
      process.stderr.write(`drift: ${path.relative(root, target)}\n`);
    }
    continue;
  }
  await writeFile(target, content, 'utf8');
  process.stdout.write(`wrote ${path.relative(root, target)}\n`);
}

if (drifted) {
  process.stderr.write('Run `npm run gen:skill` and commit the result.\n');
  process.exit(1);
}
