#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';

import { loadConfig, type UnvibeConfig } from './config.js';
import { renderPlan } from './plan.js';
import { renderBanner, showBanner } from './report/banner.js';
import { render, type Format } from './report/index.js';
import { scan, VERSION, type ScanOptions } from './scan.js';
import { HOSTS, hostSpecs, installSkill, type Host } from './skill/install.js';
import { cleanupTarget, resolveTarget, SourceError } from './source.js';
import type { Finding, Language, ScanReport, Severity } from './types.js';

const EXIT_OK = 0;
const EXIT_THRESHOLD = 1;
const EXIT_ERROR = 2;

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

const USAGE = `USAGE
  unvibe-cli scan [target] [options]     score a codebase
  unvibe-cli plan [target] [options]     emit an ordered refactor plan
  unvibe-cli skill install [options]     install the agent skill
  unvibe-cli rules                       list every rule id

TARGET
  .                                  a local directory (default)
  owner/repo                         a public GitHub repo
  https://github.com/owner/repo#ref  any git URL, optionally pinned to a ref

SCAN OPTIONS
  -f, --format <fmt>       terminal | json | markdown | sarif   (default: terminal)
  -o, --output <file>      write to a file instead of stdout
  -v, --verbose            show every finding
      --min-severity <s>   info | low | medium | high           (default: info)
      --ignore <rules>     comma-separated rule ids; supports category.*
      --languages <list>   restrict to e.g. python,typescript
      --exclude <names>    extra directory or file names to skip
      --max-slop <n>       exit 1 when the score exceeds n
      --max-findings <n>   exit 1 when findings exceed n
      --no-git             skip git history analysis
      --no-gitignore       scan files the repo's .gitignore excludes
      --no-duplication     skip cross-file clone detection
      --keep-clone         leave a cloned repo on disk and print its path
      --no-banner          suppress the startup banner
      --depth <n>          clone depth for remote targets (default: full)

SKILL OPTIONS
      --host <names>       claude,opencode,codex                (default: all)
      --project            install into this repo rather than your home directory

CONFIG
  unvibe.config.json or .unviberc.json in the scanned directory or the working
  directory. Keys: ignoreRules, exclude, languages, minSeverity, maxSlop,
  maxFindings. Flags override it; lists merge.

EXIT CODES
  0  clean   1  threshold exceeded   2  scan failed

EXAMPLES
  unvibe-cli scan .
  unvibe-cli scan facebook/react --min-severity high
  unvibe-cli scan . --format sarif -o unvibe.sarif
  unvibe-cli plan owner/repo > UNVIBE.md
  unvibe-cli skill install --host claude,codex
`;

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  const ALIASES: Record<string, string> = {
    f: 'format',
    o: 'output',
    v: 'verbose',
    h: 'help',
    V: 'version',
  };

  const VALUED = new Set([
    'format',
    'output',
    'min-severity',
    'ignore',
    'languages',
    'exclude',
    'max-slop',
    'max-findings',
    'depth',
    'host',
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }

    const isLong = arg.startsWith('--');
    const body = isLong ? arg.slice(2) : arg.slice(1);
    const [rawName, inlineValue] = body.split('=');
    const name = isLong ? (rawName ?? '') : (ALIASES[rawName ?? ''] ?? rawName ?? '');

    if (VALUED.has(name)) {
      const value = inlineValue ?? argv[++i];
      if (value === undefined) throw new Error(`--${name} needs a value`);
      flags.set(name, value);
      continue;
    }

    flags.set(name, inlineValue === undefined ? true : inlineValue !== 'false');
  }

  const command = positional.shift() ?? 'scan';
  return { command, positional, flags };
}

function list(value: string | boolean | undefined): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function number(value: string | boolean | undefined): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFormat(value: string | boolean | undefined): Format {
  if (typeof value !== 'string') return 'terminal';
  const allowed: Format[] = ['terminal', 'json', 'markdown', 'sarif'];
  if ((allowed as string[]).includes(value)) return value as Format;
  throw new Error(`Unknown format "${value}". Use one of: ${allowed.join(', ')}`);
}

function filterBySeverity(findings: Finding[], min: string | boolean | undefined): Finding[] {
  if (typeof min !== 'string') return findings;
  const floor = SEVERITY_RANK[min as Severity];
  if (floor === undefined) {
    throw new Error(`Unknown severity "${min}". Use info, low, medium or high.`);
  }
  return findings.filter((f) => SEVERITY_RANK[f.severity] <= floor);
}

/** Machine-readable output is usually piped or redirected; keep it uncluttered. */
const PIPEABLE: ReadonlySet<Format> = new Set<Format>(['json', 'sarif', 'markdown']);

function bannerFor(args: ParsedArgs, format: Format): boolean {
  return showBanner({
    version: VERSION,
    suppressed: args.flags.get('no-banner') === true || PIPEABLE.has(format),
    // Nobody is reading a banner in a CI log.
    requireTty: true,
  });
}

function scanOptionsFrom(flags: ParsedArgs['flags'], config: UnvibeConfig = {}): ScanOptions {
  // Flags win over config; where both are lists, they merge.
  const exclude = [...(config.exclude ?? []), ...list(flags.get('exclude'))];
  const flagLanguages = list(flags.get('languages')) as Language[];
  const languages = flagLanguages.length > 0 ? flagLanguages : (config.languages ?? []);
  const ignoreRules = [...(config.ignoreRules ?? []), ...list(flags.get('ignore'))];

  return {
    ...(exclude.length > 0 ? { exclude } : {}),
    ...(languages.length > 0 ? { languages } : {}),
    ...(ignoreRules.length > 0 ? { ignoreRules } : {}),
    // `--no-git` arrives as flags.get('no-git') === true.
    skipGit: flags.get('no-git') === true || flags.get('git') === false,
    respectGitignore: !(flags.get('no-gitignore') === true),
    skipDuplication: flags.get('no-duplication') === true || flags.get('duplication') === false,
    onProgress: (message) => {
      if (flags.get('verbose') === true) process.stderr.write(`  ${message}\n`);
    },
  };
}

async function runScan(args: ParsedArgs): Promise<number> {
  const input = args.positional[0] ?? '.';
  const format = parseFormat(args.flags.get('format'));
  const keepClone = args.flags.get('keep-clone') === true;
  const depth = number(args.flags.get('depth'));

  const bannerShown = bannerFor(args, format);

  const target = await resolveTarget(input, {
    keepClone,
    ...(depth !== null ? { depth } : {}),
    onProgress: (message) => process.stderr.write(`  ${message}\n`),
  });

  try {
    const config = await loadConfig(target.root, process.cwd());
    const report = await scan(target, scanOptionsFrom(args.flags, config));

    const minSeverity = args.flags.get('min-severity') ?? config.minSeverity;
    const filtered: ScanReport = {
      ...report,
      findings: filterBySeverity(report.findings, minSeverity),
    };

    const output = render(filtered, format, {
      verbose: args.flags.get('verbose') === true,
      showToolName: !bannerShown,
    });
    const outputPath = args.flags.get('output');

    if (typeof outputPath === 'string') {
      await writeFile(outputPath, output, 'utf8');
      process.stderr.write(`  Wrote ${outputPath}\n`);
    } else {
      process.stdout.write(output);
    }

    if (keepClone && target.kind === 'remote') {
      process.stderr.write(`  Clone kept at ${target.root}\n`);
    }

    const maxSlop = number(args.flags.get('max-slop')) ?? config.maxSlop ?? null;
    const maxFindings = number(args.flags.get('max-findings')) ?? config.maxFindings ?? null;

    if (maxSlop !== null && report.score.slop > maxSlop) {
      process.stderr.write(`  Slop ${report.score.slop} exceeds --max-slop ${maxSlop}\n`);
      return EXIT_THRESHOLD;
    }

    if (maxFindings !== null && filtered.findings.length > maxFindings) {
      process.stderr.write(
        `  ${filtered.findings.length} findings exceed --max-findings ${maxFindings}\n`,
      );
      return EXIT_THRESHOLD;
    }

    return EXIT_OK;
  } finally {
    await cleanupTarget(target);
  }
}

async function runPlan(args: ParsedArgs): Promise<number> {
  const input = args.positional[0] ?? '.';
  const depth = number(args.flags.get('depth'));

  // The plan itself is markdown on stdout, so the banner stays on stderr.
  bannerFor(args, 'terminal');

  const target = await resolveTarget(input, {
    ...(depth !== null ? { depth } : {}),
    onProgress: (message) => process.stderr.write(`  ${message}\n`),
  });

  try {
    const config = await loadConfig(target.root, process.cwd());
    const report = await scan(target, scanOptionsFrom(args.flags, config));
    const filtered: ScanReport = {
      ...report,
      findings: filterBySeverity(
        report.findings,
        args.flags.get('min-severity') ?? config.minSeverity,
      ),
    };

    const plan = renderPlan(filtered);
    const outputPath = args.flags.get('output');

    if (typeof outputPath === 'string') {
      await writeFile(outputPath, plan, 'utf8');
      process.stderr.write(`  Wrote ${outputPath}\n`);
    } else {
      process.stdout.write(plan);
    }

    return EXIT_OK;
  } finally {
    await cleanupTarget(target);
  }
}

async function runSkill(args: ParsedArgs): Promise<number> {
  const action = args.positional[0] ?? 'install';
  bannerFor(args, 'terminal');

  if (action === 'where') {
    const specs = hostSpecs();
    for (const host of HOSTS) {
      const spec = specs[host];
      process.stdout.write(`${spec.label}\n`);
      process.stdout.write(`  global:  ${spec.global}\n`);
      process.stdout.write(`  project: ${spec.project ?? '(not supported)'}\n`);
      process.stdout.write(`  ${spec.notes}\n\n`);
    }
    return EXIT_OK;
  }

  if (action !== 'install') {
    process.stderr.write(`Unknown skill action "${action}". Use install or where.\n`);
    return EXIT_ERROR;
  }

  const requested = list(args.flags.get('host'));
  const unknown = requested.filter((h) => !(HOSTS as string[]).includes(h));
  if (unknown.length > 0) {
    throw new Error(`Unknown host(s): ${unknown.join(', ')}. Use ${HOSTS.join(', ')}.`);
  }

  const results = await installSkill({
    ...(requested.length > 0 ? { hosts: requested as Host[] } : {}),
    project: args.flags.get('project') === true,
  });

  process.stdout.write('\n');
  for (const result of results) {
    if (result.skipped) {
      process.stdout.write(`  ${result.label}: skipped — ${result.skipped}\n`);
      continue;
    }
    process.stdout.write(`  ${result.label}: ${result.directory}\n`);
  }
  process.stdout.write(
    '\n  Restart your agent to pick it up, then ask it to unvibe the project.\n\n',
  );

  return EXIT_OK;
}

function runRules(): number {
  // Keep this in step with references/rules.md, which carries the descriptions.
  const rules = [
    'comments.banner',
    'comments.density',
    'comments.emoji',
    'comments.hedge',
    'comments.narration',
    'comments.obvious',
    'comments.redundant',
    'dead-code.unused-import',
    'duplication.cross-file',
    'duplication.within-file',
    'error-handling.bare-except',
    'error-handling.broad-except',
    'error-handling.discarded-error',
    'error-handling.empty-catch',
    'error-handling.log-and-continue',
    'error-handling.promise-catch-default',
    'error-handling.swallow-default',
    'error-handling.unwrap-density',
    'history.bulk-commits',
    'history.churn',
    'history.generic-messages',
    'history.single-drop',
    'placeholders.attributed-todo',
    'placeholders.debug-output',
    'placeholders.fake-credential',
    'placeholders.fake-endpoint',
    'placeholders.lorem',
    'placeholders.not-implemented',
    'placeholders.todo-stub',
    'structure.complexity',
    'structure.deep-nesting',
    'structure.god-file',
    'structure.long-function',
    'structure.parameter-list',
    'structure.passthrough-wrapper',
    'test-theater.mock-only',
    'test-theater.no-assertion',
    'test-theater.tautology',
    'type-escapes.any',
    'type-escapes.catch-any',
    'type-escapes.double-assertion',
    'type-escapes.lint-suppression',
    'type-escapes.mypy-suppression',
    'type-escapes.ts-suppression',
  ];

  process.stdout.write(`${rules.join('\n')}\n`);
  return EXIT_OK;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_ERROR;
  }

  if (args.flags.get('help') === true || args.command === 'help') {
    if (args.flags.get('no-banner') !== true) {
      process.stdout.write(`${renderBanner({ version: VERSION, stream: process.stdout })}\n`);
    }
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  // Bare `unvibe`: say hello and show the way in, rather than silently
  // scanning the working directory and surprising someone who just typed it.
  if (argv.length === 0) {
    process.stdout.write(`${renderBanner({ version: VERSION, stream: process.stdout })}\n`);
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  if (args.flags.get('version') === true || args.command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return EXIT_OK;
  }

  try {
    switch (args.command) {
      case 'scan':
        return await runScan(args);
      case 'plan':
        return await runPlan(args);
      case 'skill':
        return await runSkill(args);
      case 'rules':
        return runRules();
      default: {
        // `unvibe .` and `unvibe owner/repo` should just work.
        const looksLikeTarget = args.command === '.' || /[./]/.test(args.command);
        if (looksLikeTarget) {
          return await runScan({ ...args, positional: [args.command, ...args.positional] });
        }
        process.stderr.write(`unvibe ${VERSION}\n\nUnknown command "${args.command}".\n\n${USAGE}`);
        return EXIT_ERROR;
      }
    }
  } catch (error) {
    if (error instanceof SourceError) {
      process.stderr.write(`\n  ${error.message}\n\n`);
      return EXIT_ERROR;
    }
    process.stderr.write(`\n  ${error instanceof Error ? error.stack : String(error)}\n\n`);
    return EXIT_ERROR;
  }
}

// Only self-execute as a binary, so tests can import `main` freely.
if (process.argv[1] && /unvibe(-cli)?|cli\.(js|cjs|ts)$/.test(process.argv[1])) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = EXIT_ERROR;
    },
  );
}
