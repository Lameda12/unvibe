import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ScanTarget } from './types.js';

const exec = promisify(execFile);

export class SourceError extends Error {}

/** `owner/repo`, optionally with a `#ref` suffix. */
const SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

export interface ResolveOptions {
  /** Clone depth. 0 means full history, which the history detectors prefer. */
  depth?: number;
  ref?: string;
  /** Leave the temp clone on disk and print its location. */
  keepClone?: boolean;
  onProgress?: (message: string) => void;
}

function normalizeRemote(input: string): { url: string; ref?: string } | null {
  const [base, fragmentRef] = input.split('#');
  const candidate = (base ?? '').trim();
  if (!candidate) return null;

  if (candidate.startsWith('git@') || candidate.endsWith('.git')) {
    return { url: candidate, ref: fragmentRef };
  }

  if (/^https?:\/\//.test(candidate)) {
    return { url: candidate, ref: fragmentRef };
  }

  // Bare host forms people actually paste: github.com/owner/repo
  if (/^(github|gitlab|bitbucket|codeberg)\.(com|org)\//.test(candidate)) {
    return { url: `https://${candidate}`, ref: fragmentRef };
  }

  if (SHORTHAND.test(candidate)) {
    return { url: `https://github.com/${candidate}`, ref: fragmentRef };
  }

  return null;
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    // A path that cannot be stat'd is simply not a local directory, which is
    // the question being asked. The caller falls through to remote resolution.
    return false;
  }
}

/**
 * Turn whatever the user typed into a directory on disk.
 *
 * A path that exists locally always wins, so `unvibe scan .` never reaches for
 * the network and a directory literally named `owner/repo` is not hijacked.
 */
export async function resolveTarget(
  input: string,
  options: ResolveOptions = {},
): Promise<ScanTarget> {
  const local = path.resolve(process.cwd(), input);
  if (await isDirectory(local)) {
    return { input, root: local, kind: 'local', ephemeral: false };
  }

  const remote = normalizeRemote(input);
  if (!remote) {
    throw new SourceError(
      `Cannot resolve "${input}". Pass a directory that exists, a git URL, or owner/repo.`,
    );
  }

  const ref = options.ref ?? remote.ref;
  const dir = await mkdtemp(path.join(tmpdir(), 'unvibe-'));
  const depth = options.depth ?? 0;

  const args = ['clone', '--quiet', '--no-tags'];
  if (depth > 0) args.push('--depth', String(depth));
  if (ref) args.push('--branch', ref);
  args.push(remote.url, dir);

  options.onProgress?.(`Cloning ${remote.url}${ref ? `#${ref}` : ''}`);

  try {
    await exec('git', args, {
      // Refuse interactive credential prompts: this tool targets public repos.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
      maxBuffer: 1024 * 1024 * 32,
    });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    const detail = error instanceof Error ? error.message.trim().split('\n').pop() : String(error);
    throw new SourceError(`git clone failed for ${remote.url}: ${detail}`);
  }

  return {
    input,
    root: dir,
    kind: 'remote',
    remoteUrl: remote.url,
    ...(ref ? { ref } : {}),
    ephemeral: !options.keepClone,
  };
}

export async function cleanupTarget(target: ScanTarget): Promise<void> {
  if (target.kind === 'remote' && target.ephemeral) {
    await rm(target.root, { recursive: true, force: true });
  }
}

/** Exported for tests. */
export const _internal = { normalizeRemote };
