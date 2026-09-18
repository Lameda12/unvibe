import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { _internal, resolveTarget, SourceError } from './source.js';

const { normalizeRemote } = _internal;

describe('normalizeRemote', () => {
  it.each([
    ['owner/repo', 'https://github.com/owner/repo'],
    ['github.com/owner/repo', 'https://github.com/owner/repo'],
    ['https://github.com/owner/repo', 'https://github.com/owner/repo'],
    ['https://gitlab.com/group/project', 'https://gitlab.com/group/project'],
    ['git@github.com:owner/repo.git', 'git@github.com:owner/repo.git'],
    ['codeberg.org/owner/repo', 'https://codeberg.org/owner/repo'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeRemote(input)?.url).toBe(expected);
  });

  it('extracts a ref from the fragment', () => {
    expect(normalizeRemote('owner/repo#develop')).toEqual({
      url: 'https://github.com/owner/repo',
      ref: 'develop',
    });
  });

  it('rejects something that is neither a path nor a repo', () => {
    expect(normalizeRemote('not a repo at all')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(normalizeRemote('')).toBeNull();
  });
});

describe('resolveTarget', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'unvibe-test-'));
    await writeFile(path.join(dir, 'a.ts'), 'const a = 1;\n', 'utf8');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves an existing directory without touching the network', async () => {
    const target = await resolveTarget(dir);
    expect(target.kind).toBe('local');
    expect(target.root).toBe(dir);
    expect(target.ephemeral).toBe(false);
  });

  it('prefers a local directory over a same-named remote shorthand', async () => {
    const nested = path.join(dir, 'owner');
    await rm(nested, { recursive: true, force: true });
    const target = await resolveTarget(dir);
    expect(target.kind).toBe('local');
  });

  it('throws a SourceError for input that resolves to nothing', async () => {
    await expect(resolveTarget('this is not a repo or a path')).rejects.toBeInstanceOf(SourceError);
  });
});
