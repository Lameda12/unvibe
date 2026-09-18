import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * A deliberately small subset of gitignore semantics: the directory and glob
 * forms that decide whether a file is source. Anything it cannot model, it
 * declines to match, so a miss means "scanned anyway" rather than "silently
 * skipped" — the safe direction for a tool that reports on what it read.
 *
 * Not supported: `**` spanning directories in the middle of a pattern, character
 * ranges, and nested .gitignore files below the root.
 */
export class IgnoreMatcher {
  private readonly rules: Array<{ test: RegExp; negated: boolean; dirOnly: boolean }> = [];

  add(pattern: string): void {
    let body = pattern.trim();
    if (!body || body.startsWith('#')) return;

    const negated = body.startsWith('!');
    if (negated) body = body.slice(1);

    const dirOnly = body.endsWith('/');
    if (dirOnly) body = body.slice(0, -1);

    // A pattern with no slash matches at any depth; one with a slash is anchored.
    const anchored = body.includes('/');
    if (body.startsWith('/')) body = body.slice(1);

    const source = body
      .split('/')
      .map((segment) =>
        segment === '**'
          ? '.*'
          : segment
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '[^/]*')
              .replace(/\?/g, '[^/]'),
      )
      .join('/');

    const prefix = anchored ? '^' : '(^|.*/)';
    this.rules.push({
      // Match the path itself or anything beneath it, so `dist` covers `dist/a.js`.
      test: new RegExp(`${prefix}${source}(/.*)?$`),
      negated,
      dirOnly,
    });
  }

  addAll(contents: string): void {
    for (const line of contents.split('\n')) this.add(line);
  }

  /** Later rules win, which is how git resolves a negation after an ignore. */
  ignores(relativePath: string, isDirectory = false): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDirectory && !rule.test.test(relativePath)) continue;
      if (rule.test.test(relativePath)) ignored = !rule.negated;
    }
    return ignored;
  }

  get size(): number {
    return this.rules.length;
  }
}

/** Reads the repository-root .gitignore. Absent or unreadable means no rules. */
export async function loadGitignore(root: string): Promise<IgnoreMatcher> {
  const matcher = new IgnoreMatcher();
  // Most directories have no .gitignore; absence is the common case, not an error.
  const contents = await readFile(path.join(root, '.gitignore'), 'utf8').catch(() => null);
  if (contents !== null) matcher.addAll(contents);
  return matcher;
}
