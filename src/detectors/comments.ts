import type { Detector, Finding } from '../types.js';
import {
  commentText,
  identifierWords,
  isCommentLine,
  isTestPath,
  jsDocLines,
  licenseHeaderLines,
  makeFinding,
} from './util.js';

/**
 * Comments that narrate the procedure the model just wrote, rather than
 * recording a decision. "Step 1: validate input" above a validation call.
 */
const NARRATION = [
  /^step\s*\d+\s*[:.-]/i,
  /^(first|second|third|next|then|finally|lastly)\s*[,:]/i,
  /^(now|here)\s+we\b/i,
  /^we\s+(will|now|then)\b/i,
  /^let'?s\s+/i,
];

/** Comments that restate a language keyword. Cheap, high-precision tells. */
/**
 * Each pattern must match the whole comment. Anchoring matters: "Import the
 * module" is noise, but "Import encoding now, to avoid an implicit import
 * later" explains a decision, and an unanchored prefix match cannot tell them
 * apart.
 */
const OBVIOUS = [
  /^import(ing)?\s+(the\s+)?[\w.]+\.?$/i,
  /^(initialize|initialise|create|instantiate)\s+(the\s+|a\s+|an\s+)?[\w.]+\.?$/i,
  /^returns?\s+(the\s+)?[\w.]+\.?$/i,
  /^(loop|iterate)\s+(through|over)\s+(the\s+)?[\w.]+\.?$/i,
  /^(get|set)\s+the\s+[\w.]+\.?$/i,
  /^check\s+if\s+[\w.]+(\s+(is|has|exists|was))?\.?$/i,
  /^(close|open)\s+the\s+[\w.]+\.?$/i,
  /^end\s+of\s+[\w.]+\.?$/i,
  /^constructor\.?$/i,
  /^main\s+(function|entry\s?point)\.?$/i,
];

/** Section dividers a human almost never types by hand. */
const BANNER = /^[\s#/*-]*[=\-*_~#]{6,}[\s\S]*$/;
const BANNER_WITH_TITLE = /^[=\-*_~]{2,}\s*.+\s*[=\-*_~]{2,}$/;

/** The model telling you the code is not finished, in prose. */
const HEDGE = [
  /in\s+a\s+real\s+(implementation|application|world|system|scenario)/i,
  /for\s+(simplicity|brevity|now|demonstration)/i,
  /this\s+is\s+a\s+(simplified|basic|minimal|naive|placeholder|mock)/i,
  /you\s+(would|should|may|might|can)\s+(want\s+to\s+)?(replace|implement|add|adjust|customize)/i,
  /adjust\s+(this|as)\s+(as\s+)?(needed|necessary|appropriate)/i,
  /(replace|update)\s+(this\s+)?with\s+your\s+(own|actual|real)/i,
  /note\s*:\s*this\s+(is|does|assumes)/i,
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}]/u;

/** Comment-to-code ratio above which a file reads like narrated dictation. */
const COMMENT_DENSITY_CEILING = 0.4;
const DENSITY_MIN_CODE_LINES = 60;

function nextCodeLine(lines: string[], from: number): { text: string; index: number } | null {
  for (let i = from; i < Math.min(from + 3, lines.length); i += 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (
      line.trim().startsWith('//') ||
      line.trim().startsWith('#') ||
      line.trim().startsWith('*')
    ) {
      continue;
    }
    return { text: line, index: i };
  }
  return null;
}

/**
 * True when every meaningful word in the comment already appears as an
 * identifier on the line below it, i.e. the comment adds nothing a reader could
 * not get from the code itself.
 */
function restatesCode(comment: string, code: string): boolean {
  const commentWords = [...identifierWords(comment)].filter(
    (w) => !STOPWORDS.has(w) && w.length > 3,
  );
  if (commentWords.length < 2) return false;

  const codeWords = identifierWords(code);
  return commentWords.every((word) => codeWords.has(word));
}

const STOPWORDS = new Set([
  'the',
  'this',
  'that',
  'with',
  'from',
  'into',
  'then',
  'and',
  'for',
  'are',
  'was',
  'will',
  'have',
  'has',
  'all',
  'any',
  'its',
  'our',
  'you',
  'your',
]);

export const commentDetector: Detector = {
  id: 'comments',
  category: 'comments',
  supports: () => true,
  run(ctx): Finding[] {
    const findings: Finding[] = [];
    const { lines, path, language } = ctx;
    const jsDoc = jsDocLines(lines);
    const license = licenseHeaderLines(lines);
    // A test helper saying "for simplicity we assume" is describing the
    // fixture, not confessing that shipped code is unfinished.
    const inTest = isTestPath(path);

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i]!;
      if (!isCommentLine(raw, language)) continue;
      // A licence header is a legal requirement, not a decorative banner.
      if (license.has(i)) continue;
      // `# -*- coding: utf-8 -*-` and `# fmt: off` are pragmas read by tools.
      if (/^[#/]*\s*(-\*-|fmt:|noqa|pylint:|type:|eslint|prettier-ignore)/.test(raw.trim())) {
        continue;
      }

      const text = commentText(raw);
      if (!text) continue;

      const line = i + 1;
      // Inside JSDoc, describing what a function does is the whole job. Only
      // the rules that flag unfinished work still apply.
      const isApiDoc = jsDoc.has(i);

      if (BANNER.test(raw.trim()) || BANNER_WITH_TITLE.test(text)) {
        findings.push(
          makeFinding({
            rule: 'comments.banner',
            category: 'comments',
            severity: 'info',
            message: 'Decorative section banner comment.',
            path,
            line,
            snippet: raw,
            remediation:
              'Delete the banner. If the file needs sections this loudly, split it into modules.',
            autofixable: true,
          }),
        );
        continue;
      }

      const hedge = !inTest && HEDGE.some((pattern) => pattern.test(text));
      if (hedge) {
        findings.push(
          makeFinding({
            rule: 'comments.hedge',
            category: 'comments',
            severity: 'high',
            message: 'Comment admits the code is a placeholder or simplification.',
            path,
            line,
            snippet: raw,
            remediation:
              'Either finish the implementation or convert this into a tracked issue. Shipped code should not describe itself as illustrative.',
          }),
        );
        continue;
      }

      if (!isApiDoc && NARRATION.some((pattern) => pattern.test(text))) {
        findings.push(
          makeFinding({
            rule: 'comments.narration',
            category: 'comments',
            severity: 'low',
            message: 'Comment narrates the procedure instead of explaining a decision.',
            path,
            line,
            snippet: raw,
            remediation:
              'Delete it, or replace it with the reason this step exists rather than the fact that it exists.',
            autofixable: true,
          }),
        );
        continue;
      }

      if (!isApiDoc && OBVIOUS.some((pattern) => pattern.test(text))) {
        findings.push(
          makeFinding({
            rule: 'comments.obvious',
            category: 'comments',
            severity: 'low',
            message: 'Comment restates a language keyword.',
            path,
            line,
            snippet: raw,
            remediation: 'Delete it. The code already says this.',
            autofixable: true,
          }),
        );
        continue;
      }

      if (EMOJI.test(text)) {
        findings.push(
          makeFinding({
            rule: 'comments.emoji',
            category: 'comments',
            severity: 'info',
            message: 'Emoji-decorated comment.',
            path,
            line,
            snippet: raw,
            remediation: 'Strip the decoration; keep the sentence if it says something.',
            autofixable: true,
          }),
        );
        continue;
      }

      const next = nextCodeLine(lines, i + 1);
      if (!isApiDoc && next && restatesCode(text, next.text)) {
        findings.push(
          makeFinding({
            rule: 'comments.redundant',
            category: 'comments',
            severity: 'low',
            message: 'Comment repeats the identifiers on the line below it.',
            path,
            line,
            snippet: raw,
            remediation: 'Delete it. Every word in it is already visible in the code.',
            autofixable: true,
          }),
        );
      }
    }

    // Count only narrative comments. JSDoc is API reference documentation, and
    // a thoroughly documented library should not be penalised for having it.
    const narrativeComments = lines.filter(
      (raw, index) => !jsDoc.has(index) && !license.has(index) && isCommentLine(raw, language),
    ).length;

    const { codeLines } = ctx.stats;
    if (codeLines >= DENSITY_MIN_CODE_LINES) {
      const ratio = narrativeComments / codeLines;
      if (ratio > COMMENT_DENSITY_CEILING) {
        findings.push(
          makeFinding({
            rule: 'comments.density',
            category: 'comments',
            severity: 'medium',
            message: `Narrative comments are ${Math.round(ratio * 100)}% of code lines in this file.`,
            path,
            line: 1,
            snippet: `${narrativeComments} narrative comment lines / ${codeLines} code lines`,
            remediation:
              'Cut narration down to the comments that record a decision, a constraint, or a workaround.',
          }),
        );
      }
    }

    return findings;
  },
};
