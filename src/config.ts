import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Language, Severity } from './types.js';

export const CONFIG_FILENAMES = ['unvibe.config.json', '.unviberc.json'];

export interface UnvibeConfig {
  /** Rule ids to drop, `category.*` supported. */
  ignoreRules?: string[];
  /** Extra directory or file names to skip. */
  exclude?: string[];
  languages?: Language[];
  minSeverity?: Severity;
  maxSlop?: number;
  maxFindings?: number;
}

const KNOWN_KEYS = new Set([
  'ignoreRules',
  'exclude',
  'languages',
  'minSeverity',
  'maxSlop',
  'maxFindings',
]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Validate rather than trust. A config with a typo should say so, not silently
 * apply nothing and leave the user wondering why their ignores do not work.
 */
export function parseConfig(raw: unknown, source: string): UnvibeConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${source}: expected a JSON object.`);
  }

  const input = raw as Record<string, unknown>;
  const config: UnvibeConfig = {};

  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`${source}: unknown key "${key}". Known keys: ${[...KNOWN_KEYS].join(', ')}`);
    }
  }

  for (const key of ['ignoreRules', 'exclude', 'languages'] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!isStringArray(value)) throw new Error(`${source}: "${key}" must be an array of strings.`);
    if (key === 'languages') config.languages = value as Language[];
    else config[key] = value;
  }

  if (input.minSeverity !== undefined) {
    const value = input.minSeverity;
    if (!['info', 'low', 'medium', 'high'].includes(value as string)) {
      throw new Error(`${source}: "minSeverity" must be info, low, medium or high.`);
    }
    config.minSeverity = value as Severity;
  }

  for (const key of ['maxSlop', 'maxFindings'] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${source}: "${key}" must be a number.`);
    }
    config[key] = value;
  }

  return config;
}

/** Looks in the scanned directory first, then the working directory. */
export async function loadConfig(...directories: string[]): Promise<UnvibeConfig> {
  for (const directory of directories) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(directory, filename);
      // Absence is the common case: most directories have no config file.
      const contents = await readFile(candidate, 'utf8').catch(() => null);
      if (contents === null) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(contents);
      } catch (error) {
        throw new Error(
          `${candidate}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return parseConfig(parsed, candidate);
    }
  }

  return {};
}
