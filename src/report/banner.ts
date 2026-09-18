/**
 * The launch banner.
 *
 * It always goes to stderr. `unvibe scan . --format json > report.json` has to
 * produce a parseable file, and a banner on stdout would corrupt every
 * machine-readable format the tool offers.
 */

const ART = [
  '█   █ █   █ █   █ █████ ████  █████        ████ █     █████',
  '█   █ ██  █ █   █   █   █   █ █           █     █       █  ',
  '█   █ █ █ █ █   █   █   ████  ████   ███  █     █       █  ',
  '█   █ █  ██  █ █    █   █   █ █           █     █       █  ',
  ' ███  █   █   █   █████ ████  █████        ████ █████ █████',
];

/** Same fallback the terminal reporter uses, kept independent of it. */
export function supportsColor(stream: NodeJS.WriteStream): boolean {
  return (
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== 'dumb' &&
    (stream.isTTY === true || process.env.FORCE_COLOR !== undefined)
  );
}

export interface BannerOptions {
  version: string;
  /** Printed under the art. Omit for the bare logo. */
  tagline?: string;
  /**
   * Colour must follow the stream the banner is actually written to. Deciding
   * from stderr and then writing to stdout leaks escape codes into
   * `unvibe --help > notes.txt`.
   */
  stream?: NodeJS.WriteStream;
  color?: boolean;
}

export function renderBanner(options: BannerOptions): string {
  const color = options.color ?? supportsColor(options.stream ?? process.stderr);
  const dim = (text: string) => (color ? `[90m${text}[0m` : text);
  const bright = (text: string) => (color ? `[36m${text}[0m` : text);

  const lines = ['', ...ART.map((row) => `  ${bright(row)}`), ''];

  const tagline = options.tagline ?? 'find and fix AI slop in a codebase';
  lines.push(dim(`  v${options.version}  ${tagline}`));
  lines.push('');

  return lines.join('\n');
}

export interface ShowBannerOptions extends BannerOptions {
  /** `--no-banner`, or a format whose output is meant to be piped. */
  suppressed?: boolean;
  /** Skip the banner when nobody is watching, e.g. output is redirected in CI. */
  requireTty?: boolean;
  write?: (text: string) => void;
}

/**
 * Returns whether it printed, so callers can keep their own spacing consistent.
 */
export function showBanner(options: ShowBannerOptions): boolean {
  if (options.suppressed) return false;
  if (options.requireTty && process.stderr.isTTY !== true) return false;

  const write = options.write ?? ((text: string) => process.stderr.write(text));
  write(`${renderBanner(options)}\n`);
  return true;
}
