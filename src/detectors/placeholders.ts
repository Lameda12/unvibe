import type { Detector, Finding, Severity } from '../types.js';
import { isCommentLine, isExamplePath, isTestPath, makeFinding } from './util.js';

interface PlaceholderRule {
  rule: string;
  pattern: RegExp;
  severity: Severity;
  message: string;
  remediation: string;
  /** Skip this rule on comment lines, where the text is documentation. */
  skipInComments?: boolean;
}

const RULES: PlaceholderRule[] = [
  {
    rule: 'placeholders.not-implemented',
    pattern:
      /\b(raise\s+NotImplementedError|throw\s+new\s+Error\(\s*['"`](?:not\s+implemented|unimplemented|todo)|panic!\(\s*"(?:not implemented|todo)|todo!\(\))/i,
    severity: 'high',
    message: 'Function body is an explicit "not implemented" stub.',
    remediation:
      'Implement it, delete it, or move it behind an interface that nothing calls yet. A stub reachable from production is a runtime error waiting for a user.',
  },
  {
    rule: 'placeholders.fake-credential',
    skipInComments: true,
    pattern:
      /(your[-_ ]?(api[-_ ]?key|token|secret|password)[-_ ]?here|<YOUR_[A-Z_]+>|sk-(?:xxx|test|placeholder)|xxxxxxxx|changeme|replace[-_ ]me)/i,
    severity: 'high',
    message: 'Placeholder credential left in source.',
    remediation:
      'Read it from the environment and fail loudly at startup when it is missing, rather than shipping a string that silently 401s.',
  },
  {
    rule: 'placeholders.fake-endpoint',
    skipInComments: true,
    pattern: /https?:\/\/(?:api\.)?(?:example\.(?:com|org)|your-\w+|localhost:\d+\/api\/v\d)/i,
    severity: 'medium',
    message: 'Placeholder or hardcoded endpoint.',
    remediation: 'Move the base URL into configuration with a real default for each environment.',
  },
  {
    rule: 'placeholders.todo-stub',
    pattern: /\b(TODO|FIXME|XXX|HACK)\b\s*[:(]?\s*(implement|add|handle|finish|complete|write)/i,
    severity: 'medium',
    message: 'TODO marking unfinished behaviour.',
    remediation:
      'Track it in the issue tracker with an owner, or finish it. TODOs in a vibe-coded file are usually the parts that were never written.',
  },
  {
    rule: 'placeholders.attributed-todo',
    pattern: /\b(TODO|FIXME)\s*\(\s*(claude|gpt|copilot|cursor|ai|assistant|llm|bot)\s*\)/i,
    severity: 'high',
    message: 'TODO attributed to an AI assistant.',
    remediation: 'Nobody owns this. Assign it to a person or delete the code path it guards.',
  },
  {
    rule: 'placeholders.lorem',
    skipInComments: true,
    pattern: /\blorem\s+ipsum\b|\bfoo\s*\/\s*bar\b|\bjohn\s+doe\b|\bjane\s+doe\b/i,
    severity: 'low',
    message: 'Filler content left in source.',
    remediation: 'Replace with real copy or load it from a fixture that is clearly marked as one.',
  },
  {
    rule: 'placeholders.debug-output',
    skipInComments: true,
    pattern:
      /\b(console\.log|print\(|println!|fmt\.Println|System\.out\.println)\s*\(\s*['"`](?:here|test|debug|asdf|hello|aaa|\d+)['"`]\s*\)/i,
    severity: 'medium',
    message: 'Debug print left in source.',
    remediation: 'Delete it or route it through the project logger at debug level.',
  },
];

export const placeholderDetector: Detector = {
  id: 'placeholders',
  category: 'placeholders',
  /**
   * Fixtures and examples exist to contain exactly these patterns: a test that
   * asserts on `your-api-key-here` is doing its job, and an example that shows
   * `example.com` is showing the reader what to replace.
   */
  supports: (ctx) => !isTestPath(ctx.path) && !isExamplePath(ctx.path),
  run(ctx): Finding[] {
    const findings: Finding[] = [];
    for (let i = 0; i < ctx.lines.length; i += 1) {
      const raw = ctx.lines[i]!;
      const isComment = isCommentLine(raw, ctx.language);

      for (const rule of RULES) {
        if (rule.skipInComments && isComment) continue;

        if (!rule.pattern.test(raw)) continue;

        findings.push(
          makeFinding({
            rule: rule.rule,
            category: 'placeholders',
            severity: rule.severity,
            message: rule.message,
            path: ctx.path,
            line: i + 1,
            snippet: raw,
            remediation: rule.remediation,
          }),
        );
      }
    }

    return findings;
  },
};
