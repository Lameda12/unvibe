import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { FileStats, Language } from './types.js';

const EXTENSION_LANGUAGE: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
};

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.idea',
  '.vscode',
  'Pods',
  'DerivedData',
  // Illustrative code, not the shipped product. Placeholder hosts, fake keys
  // and long inline functions are the point of an example.
  'examples',
  'example',
  'samples',
  'demo',
  'demos',
  'benchmark',
  'benchmarks',
  'fixtures',
  '__fixtures__',
]);

/** Generated or vendored files that would poison the score. */
const IGNORED_FILE_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.bundle\.js$/,
  /[.-]lock\.(json|yaml|yml)$/,
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^poetry\.lock$/,
  /^Cargo\.lock$/,
  /\.d\.ts$/,
  /\.snap$/,
  /_pb2?\.(py|js|ts)$/,
  /\.generated\./,
  /\.pb\.go$/,
];

/** Single-line comment prefixes used for the comment-density stat. */
const LINE_COMMENT: Partial<Record<Language, string[]>> = {
  typescript: ['//'],
  javascript: ['//'],
  python: ['#'],
  go: ['//'],
  rust: ['//'],
  java: ['//'],
  ruby: ['#'],
  php: ['//', '#'],
  csharp: ['//'],
  c: ['//'],
  cpp: ['//'],
  shell: ['#'],
};

const MAX_FILE_BYTES = 1_500_000;
const NUL = String.fromCharCode(0);

export function languageOf(filePath: string): Language | null {
  return EXTENSION_LANGUAGE[path.extname(filePath).toLowerCase()] ?? null;
}

function isIgnoredFile(name: string): boolean {
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Cheap binary sniff. Anything with a NUL byte in the first 8KB is not source we
 * can reason about, whatever its extension claims.
 */
function looksBinary(content: string): boolean {
  return content.slice(0, 8192).includes(NUL);
}

export function measure(filePath: string, language: Language, source: string): FileStats {
  const lines = source.split('\n');
  const prefixes = LINE_COMMENT[language] ?? ['//'];

  let commentLines = 0;
  let codeLines = 0;
  let inBlock = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (inBlock) {
      commentLines += 1;
      if (line.includes('*/') || line.includes('"""') || line.includes("'''")) inBlock = false;
      continue;
    }

    const isBlockOpen =
      (line.startsWith('/*') && !line.includes('*/')) ||
      ((line.startsWith('"""') || line.startsWith("'''")) && line.length <= 3);

    if (isBlockOpen) {
      inBlock = true;
      commentLines += 1;
      continue;
    }

    if (prefixes.some((p) => line.startsWith(p)) || line.startsWith('/*') || line.startsWith('*')) {
      commentLines += 1;
      continue;
    }

    codeLines += 1;
  }

  return {
    path: filePath,
    language,
    lines: lines.length,
    codeLines,
    commentLines,
    bytes: Buffer.byteLength(source, 'utf8'),
  };
}

export interface SourceFile {
  stats: FileStats;
  source: string;
}

export interface WalkOptions {
  /** Extra directory or file names to skip. */
  exclude?: string[];
  /** Restrict to these languages. */
  languages?: Language[];
  maxFiles?: number;
}

export async function collectFiles(root: string, options: WalkOptions = {}): Promise<SourceFile[]> {
  const exclude = new Set(options.exclude ?? []);
  const languages = options.languages ? new Set(options.languages) : null;
  const maxFiles = options.maxFiles ?? 20_000;
  const collected: SourceFile[] = [];

  async function visit(dir: string): Promise<void> {
    if (collected.length >= maxFiles) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Unreadable directory: skip rather than abort the whole scan.
    }

    for (const entry of entries) {
      if (collected.length >= maxFiles) return;

      const absolute = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || exclude.has(entry.name)) continue;
        await visit(absolute);
        continue;
      }

      if (!entry.isFile()) continue;
      if (exclude.has(entry.name) || isIgnoredFile(entry.name)) continue;

      const language = languageOf(entry.name);
      if (!language) continue;
      if (languages && !languages.has(language)) continue;

      // A file that vanished or cannot be stat'd between readdir and here is
      // not a finding, it is a race with the filesystem. Skip it.
      const info = await stat(absolute).catch(() => null);
      if (!info || info.size > MAX_FILE_BYTES) continue;

      // Same for unreadable files: permissions and broken symlinks are the
      // caller's environment, not a property of the code being scanned.
      const source = await readFile(absolute, 'utf8').catch(() => null);
      if (source === null || looksBinary(source)) continue;

      const relative = path.relative(root, absolute).split(path.sep).join('/');
      collected.push({ stats: measure(relative, language, source), source });
    }
  }

  await visit(root);
  return collected;
}
