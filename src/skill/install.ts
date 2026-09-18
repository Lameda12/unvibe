import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { RULES_MD, SKILL_MD } from './content.js';

export type Host = 'claude' | 'opencode' | 'codex';

export const HOSTS: Host[] = ['claude', 'opencode', 'codex'];

export interface HostSpec {
  host: Host;
  label: string;
  /** Where the skill lives when installed for the whole machine. */
  global: string;
  /** Where it lives when installed for one repository. */
  project: string | null;
  notes: string;
}

/**
 * Claude Code, OpenCode and Codex have converged on the same shape: a directory
 * per skill holding a SKILL.md with `name` and `description` frontmatter. Only
 * the search paths differ, so one file serves all three.
 */
export function hostSpecs(home = homedir(), cwd = process.cwd()): Record<Host, HostSpec> {
  return {
    claude: {
      host: 'claude',
      label: 'Claude Code',
      global: path.join(home, '.claude', 'skills', 'unvibe'),
      project: path.join(cwd, '.claude', 'skills', 'unvibe'),
      notes: 'Invoke with /unvibe, or just ask Claude to unvibe the project.',
    },
    opencode: {
      host: 'opencode',
      label: 'OpenCode',
      global: path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'),
        'opencode',
        'skills',
        'unvibe',
      ),
      project: path.join(cwd, '.opencode', 'skills', 'unvibe'),
      notes: 'Discovered by the built-in skill tool on next start.',
    },
    codex: {
      host: 'codex',
      label: 'Codex CLI',
      global: path.join(process.env.CODEX_HOME ?? path.join(home, '.codex'), 'skills', 'unvibe'),
      // Codex reads skills from CODEX_HOME only, so there is no per-repo path.
      project: null,
      notes: 'Codex resolves skills from CODEX_HOME; there is no per-repo location.',
    },
  };
}

export interface InstallResult {
  host: Host;
  label: string;
  directory: string;
  files: string[];
  skipped?: string;
}

export interface InstallOptions {
  hosts?: Host[];
  /** Install into the current repository rather than the user's home. */
  project?: boolean;
  home?: string;
  cwd?: string;
}

export async function installSkill(options: InstallOptions = {}): Promise<InstallResult[]> {
  const specs = hostSpecs(options.home, options.cwd);
  const hosts = options.hosts ?? HOSTS;
  const results: InstallResult[] = [];

  for (const host of hosts) {
    const spec = specs[host];
    const directory = options.project ? spec.project : spec.global;

    if (!directory) {
      results.push({
        host,
        label: spec.label,
        directory: spec.global,
        files: [],
        skipped: spec.notes,
      });
      continue;
    }

    await mkdir(path.join(directory, 'references'), { recursive: true });

    const skillPath = path.join(directory, 'SKILL.md');
    const rulesPath = path.join(directory, 'references', 'rules.md');

    await writeFile(skillPath, SKILL_MD, 'utf8');
    await writeFile(rulesPath, RULES_MD, 'utf8');

    results.push({ host, label: spec.label, directory, files: [skillPath, rulesPath] });
  }

  return results;
}
