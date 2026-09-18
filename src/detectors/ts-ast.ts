import ts from 'typescript';

import type { Detector, DetectorContext, Finding, Severity } from '../types.js';
import { isJsFamily, isTestPath, makeFinding } from './util.js';

/** Functions longer than this stop fitting in a reviewer's head. */
const MAX_FUNCTION_LINES = 60;
/** Branch count above which a function is doing too many jobs. Matches SonarQube's default. */
const MAX_COMPLEXITY = 15;
const MAX_NESTING = 4;
const MAX_PARAMS = 5;
/** Files above this are usually an unrefactored dump. */
const MAX_FILE_LINES = 600;

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function endLineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function textOf(sourceFile: ts.SourceFile, node: ts.Node): string {
  const start = node.getStart(sourceFile);
  const lineIndex = sourceFile.getLineAndCharacterOfPosition(start).line;
  const lineStart = sourceFile.getLineStarts()[lineIndex]!;
  const lineEnd = sourceFile.text.indexOf('\n', lineStart);
  const raw = sourceFile.text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  return raw || sourceFile.text.slice(start, Math.min(start + 120, sourceFile.text.length));
}

/** A value that means "we gave up": null, undefined, [], {}, 0, '', false. */
function isEmptyish(node: ts.Expression): boolean {
  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isIdentifier(node) && node.text === 'undefined') return true;
  if (ts.isArrayLiteralExpression(node)) return node.elements.length === 0;
  if (ts.isObjectLiteralExpression(node)) return node.properties.length === 0;
  if (ts.isNumericLiteral(node)) return node.text === '0' || node.text === '-1';
  if (ts.isStringLiteralLike(node)) return node.text === '';
  return false;
}

function isLoggingCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;

  const object = callee.expression.getText();
  const method = callee.name.text;
  const loggerish = /^(console|logger|log|winston|pino|this\.logger)$/i.test(object);
  const logMethod = /^(log|info|warn|error|debug|trace|verbose)$/.test(method);
  return loggerish && logMethod;
}

/** Statements that neither rethrow, return a real value, nor recover. */
function analyzeCatchBody(block: ts.Block): 'empty' | 'log-only' | 'swallow-default' | 'handled' {
  const statements = block.statements.filter((s) => !ts.isEmptyStatement(s));
  if (statements.length === 0) return 'empty';

  let sawLog = false;

  for (const statement of statements) {
    if (ts.isThrowStatement(statement)) return 'handled';

    if (ts.isExpressionStatement(statement)) {
      if (isLoggingCall(statement.expression)) {
        sawLog = true;
        continue;
      }
      return 'handled';
    }

    if (ts.isReturnStatement(statement)) {
      if (!statement.expression) return sawLog ? 'log-only' : 'swallow-default';
      return isEmptyish(statement.expression) ? 'swallow-default' : 'handled';
    }

    return 'handled';
  }

  return sawLog ? 'log-only' : 'handled';
}

interface CatchRule {
  rule: string;
  /**
   * Deliberate swallowing is almost always explained; silent swallowing almost
   * never is. A comment in the block counts as evidence of a decision, so the
   * same shape is scored differently depending on whether anyone wrote down why.
   */
  severity: { plain: Severity; explained: Severity };
  message: string;
  remediation: string;
}

const CATCH_RULES: Record<'empty' | 'log-only' | 'swallow-default', CatchRule> = {
  empty: {
    rule: 'error-handling.empty-catch',
    severity: { plain: 'high', explained: 'low' },
    message: 'Catch block is empty.',
    remediation:
      'Handle the error, rethrow it, or delete the try. Silently swallowing it turns a bug into a mystery.',
  },
  'log-only': {
    rule: 'error-handling.log-and-continue',
    severity: { plain: 'medium', explained: 'info' },
    message: 'Catch block logs the error and continues as if it succeeded.',
    remediation:
      'Decide what the caller should see. If the operation failed, say so; if it is genuinely optional, say that in a comment.',
  },
  'swallow-default': {
    rule: 'error-handling.swallow-default',
    severity: { plain: 'high', explained: 'low' },
    message: 'Catch block replaces the error with an empty default value.',
    remediation:
      'Return a result type or let it throw. A caller cannot distinguish "no data" from "the request blew up".',
  },
};

function checkCatchClause(
  node: ts.CatchClause,
  sourceFile: ts.SourceFile,
  ctx: DetectorContext,
): Finding[] {
  const findings: Finding[] = [];
  const line = lineOf(sourceFile, node);
  const verdict = analyzeCatchBody(node.block);

  if (verdict !== 'handled') {
    const rule = CATCH_RULES[verdict];
    const blockText = sourceFile.text.slice(node.block.getStart(sourceFile), node.block.getEnd());
    const explained = /(^|\s)(\/\/|\/\*)/.test(blockText);

    findings.push(
      makeFinding({
        rule: rule.rule,
        category: 'error-handling',
        severity: explained ? rule.severity.explained : rule.severity.plain,
        message: rule.message,
        path: ctx.path,
        line,
        endLine: endLineOf(sourceFile, node),
        snippet: textOf(sourceFile, node),
        remediation: rule.remediation,
      }),
    );
  }

  if (node.variableDeclaration?.type?.kind === ts.SyntaxKind.AnyKeyword) {
    findings.push(
      makeFinding({
        rule: 'type-escapes.catch-any',
        category: 'type-escapes',
        severity: 'low',
        message: 'Caught error is typed `any`.',
        path: ctx.path,
        line,
        snippet: textOf(sourceFile, node),
        remediation: 'Use `unknown` and narrow it before touching its properties.',
      }),
    );
  }

  return findings;
}

/**
 * `.catch(() => null)` and friends, which convert a rejection into a lie. A
 * comment on the line above counts as a decision, same as a catch block.
 */
function checkPromiseCatch(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  ctx: DetectorContext,
): Finding[] {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'catch') return [];

  const handler = node.arguments[0];
  if (!handler || !ts.isArrowFunction(handler)) return [];

  const body = handler.body;
  const returned = ts.isBlock(body)
    ? body.statements.length === 1 && ts.isReturnStatement(body.statements[0]!)
      ? body.statements[0].expression
      : undefined
    : body;

  if (!returned || !isEmptyish(returned)) return [];

  const line = lineOf(sourceFile, node);
  const previous = ctx.lines[line - 2]?.trim() ?? '';
  const explained = previous.startsWith('//') || previous.startsWith('*');

  return [
    makeFinding({
      rule: 'error-handling.promise-catch-default',
      category: 'error-handling',
      severity: explained ? 'low' : 'high',
      message: 'Promise rejection is replaced with an empty default value.',
      path: ctx.path,
      line,
      endLine: endLineOf(sourceFile, node),
      snippet: textOf(sourceFile, node),
      remediation:
        'Let the rejection propagate, or handle the specific failure you expect. Returning an empty value here makes a network failure indistinguishable from an empty result.',
    }),
  ];
}

/** `x as unknown as T`: an assertion whose operand is itself an assertion to `unknown`. */
function checkDoubleAssertion(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  ctx: DetectorContext,
): Finding[] {
  if (!ts.isAsExpression(node)) return [];
  if (!ts.isAsExpression(node.expression)) return [];
  if (node.expression.type.kind !== ts.SyntaxKind.UnknownKeyword) return [];

  return [
    makeFinding({
      rule: 'type-escapes.double-assertion',
      category: 'type-escapes',
      severity: 'medium',
      message: 'Double type assertion (`as unknown as T`) bypasses the type system.',
      path: ctx.path,
      line: lineOf(sourceFile, node),
      snippet: textOf(sourceFile, node),
      remediation:
        'Model the real shape, or validate at the boundary with a parser so the assertion becomes a check.',
    }),
  ];
}

interface FunctionMetrics {
  lines: number;
  complexity: number;
  nesting: number;
  params: number;
}

const BRANCHING = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
]);

const NESTING_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
]);

function measureFunction(
  node: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): FunctionMetrics {
  let complexity = 1;
  let maxNesting = 0;

  const visit = (child: ts.Node, depth: number): void => {
    // Do not count a nested function's branches against its parent.
    if (child !== node && ts.isFunctionLike(child)) return;

    if (BRANCHING.has(child.kind)) complexity += 1;
    if (ts.isBinaryExpression(child)) {
      const op = child.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        complexity += 1;
      }
    }

    const nextDepth = NESTING_KINDS.has(child.kind) ? depth + 1 : depth;
    maxNesting = Math.max(maxNesting, nextDepth);
    child.forEachChild((grandchild) => visit(grandchild, nextDepth));
  };

  node.forEachChild((child) => visit(child, 0));

  return {
    lines: endLineOf(sourceFile, node) - lineOf(sourceFile, node) + 1,
    complexity,
    nesting: maxNesting,
    params: node.parameters.length,
  };
}

/**
 * `ts.isFunctionLike` widens to SignatureDeclaration, which has no body. Narrow
 * to the declaration forms that actually carry one.
 */
function asFunctionDeclaration(node: ts.Node): ts.FunctionLikeDeclaration | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    return node;
  }
  return null;
}

function functionName(node: ts.FunctionLikeDeclaration): string {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return '<anonymous>';
}

/**
 * A wrapper that forwards its arguments unchanged to exactly one call and adds
 * nothing. Common when a model is asked to "add a service layer".
 *
 * Only named declarations qualify. An inline `(x) => pred.test(x)` passed to
 * `.filter()` forwards its argument too, but it exists to adapt a signature,
 * which is the opposite of redundant.
 */
function isPassthrough(node: ts.FunctionLikeDeclaration, name: string): boolean {
  if (name === '<anonymous>') return false;
  if (ts.isCallExpression(node.parent)) return false;

  const body = node.body;
  if (!body) return false;

  let expression: ts.Expression | undefined;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1) return false;
    const only = body.statements[0]!;
    if (ts.isReturnStatement(only)) expression = only.expression;
    else if (ts.isExpressionStatement(only)) expression = only.expression;
    else return false;
  } else {
    expression = body;
  }

  if (!expression) return false;
  if (ts.isAwaitExpression(expression)) expression = expression.expression;
  if (!ts.isCallExpression(expression)) return false;
  if (node.parameters.length === 0) return false;

  // `this.router.route(path)` is a facade over internal state, which is a
  // design decision. Only a call to a free function is plainly redundant.
  const target = expression.expression;
  if (ts.isPropertyAccessExpression(target)) {
    let root: ts.Node = target.expression;
    while (ts.isPropertyAccessExpression(root)) root = root.expression;
    if (root.kind === ts.SyntaxKind.ThisKeyword) return false;
  }
  if (expression.arguments.length !== node.parameters.length) return false;

  const paramNames = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
  if (paramNames.some((paramName) => paramName === null)) return false;

  return expression.arguments.every(
    (arg, index) => ts.isIdentifier(arg) && arg.text === paramNames[index],
  );
}

interface MetricRule {
  rule: string;
  /** Value above which the rule fires. */
  limit: number;
  read: (metrics: FunctionMetrics) => number;
  message: (name: string, value: number) => string;
  remediation: string;
  /** Escalate from low to medium once the value is this multiple of the limit. */
  escalateAt?: number;
}

const METRIC_RULES: MetricRule[] = [
  {
    rule: 'structure.long-function',
    limit: MAX_FUNCTION_LINES,
    read: (m) => m.lines,
    message: (name, value) => `Function "${name}" is ${value} lines.`,
    remediation: 'Split it. Each extracted piece should be nameable in three words.',
    escalateAt: 2,
  },
  {
    rule: 'structure.complexity',
    limit: MAX_COMPLEXITY,
    read: (m) => m.complexity,
    message: (name, value) => `Function "${name}" has ${value} branches.`,
    remediation:
      'Pull the branches apart. A lookup table or early returns usually collapse most of them.',
    escalateAt: 2,
  },
  {
    rule: 'structure.deep-nesting',
    limit: MAX_NESTING,
    read: (m) => m.nesting,
    message: (name, value) => `Function "${name}" nests ${value} levels deep.`,
    remediation: 'Invert the conditions and return early.',
  },
  {
    rule: 'structure.parameter-list',
    limit: MAX_PARAMS,
    read: (m) => m.params,
    message: (name, value) => `Function "${name}" takes ${value} parameters.`,
    remediation: 'Group the related ones into an options object.',
  },
];

/** `describe`, `it`, `beforeEach` and friends: the callback is a block, not a unit. */
const SUITE_CALLEE =
  /^(describe|it|test|suite|context|before|after|beforeEach|afterEach|beforeAll|afterAll)$/;

function isSuiteCallback(node: ts.FunctionLikeDeclaration): boolean {
  const parent = node.parent;
  if (!ts.isCallExpression(parent)) return false;

  const callee = parent.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
      ? callee.expression.text
      : '';

  return SUITE_CALLEE.test(name);
}

function checkFunction(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  ctx: DetectorContext,
  inTest: boolean,
): Finding[] {
  const declaration = asFunctionDeclaration(node);
  if (!declaration?.body) return [];
  // A test body is long and branchy by nature; measuring it says nothing.
  if (inTest || isSuiteCallback(declaration)) return [];

  const findings: Finding[] = [];
  const metrics = measureFunction(declaration, sourceFile);
  const name = functionName(declaration);
  const line = lineOf(sourceFile, declaration);
  const endLine = endLineOf(sourceFile, declaration);
  const snippet = textOf(sourceFile, declaration);

  for (const rule of METRIC_RULES) {
    const value = rule.read(metrics);
    if (value <= rule.limit) continue;

    const escalated = rule.escalateAt !== undefined && value > rule.limit * rule.escalateAt;

    findings.push(
      makeFinding({
        rule: rule.rule,
        category: 'structure',
        severity: escalated ? 'medium' : 'low',
        message: rule.message(name, value),
        path: ctx.path,
        line,
        endLine,
        snippet,
        remediation: rule.remediation,
      }),
    );
  }

  if (!inTest && isPassthrough(declaration, name)) {
    findings.push(
      makeFinding({
        rule: 'structure.passthrough-wrapper',
        category: 'structure',
        severity: 'medium',
        message: `Function "${name}" forwards its arguments and adds nothing.`,
        path: ctx.path,
        line,
        endLine,
        snippet,
        remediation:
          'Delete the wrapper and call the inner function directly, unless it exists to pin a seam you actually swap.',
      }),
    );
  }

  return findings;
}

function collectUnusedImports(sourceFile: ts.SourceFile, path: string): Finding[] {
  const imported = new Map<string, ts.Node>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    // A bare `import './side-effect'` has no bindings to be unused.
    if (clause.isTypeOnly) continue;

    if (clause.name) imported.set(clause.name.text, clause.name);

    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) imported.set(element.name.text, element.name);
      }
    }
  }

  if (imported.size === 0) return [];

  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    const isDeclarationSite = ts.isImportSpecifier(node.parent) || ts.isImportClause(node.parent);
    if (ts.isIdentifier(node) && !isDeclarationSite) used.add(node.text);
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);

  const findings: Finding[] = [];
  for (const [name, node] of imported) {
    if (used.has(name)) continue;
    findings.push(
      makeFinding({
        rule: 'dead-code.unused-import',
        category: 'dead-code',
        severity: 'low',
        message: `Imported "${name}" is never used.`,
        path,
        line: lineOf(sourceFile, node),
        snippet: textOf(sourceFile, node),
        remediation: 'Delete the import.',
        autofixable: true,
      }),
    );
  }
  return findings;
}

function collectSuppressions(ctx: DetectorContext): Finding[] {
  const findings: Finding[] = [];

  ctx.lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*')) return;

    if (/@ts-(ignore|nocheck|expect-error)/.test(line)) {
      const isExpectError = line.includes('@ts-expect-error');
      const hasReason = /@ts-(ignore|nocheck|expect-error)\s*[-:]?\s*\S+/.test(line);
      // An explained @ts-expect-error is a deliberate, self-removing assertion.
      if (!(isExpectError && hasReason)) {
        findings.push(
          makeFinding({
            rule: 'type-escapes.ts-suppression',
            category: 'type-escapes',
            severity: isExpectError ? 'low' : 'medium',
            message: 'TypeScript error suppressed.',
            path: ctx.path,
            line: index + 1,
            snippet: raw,
            remediation:
              'Fix the underlying type, or narrow the suppression to one line and write down why it is safe.',
          }),
        );
      }
    }

    if (/eslint-disable(-next-line)?\s+\S/.test(line) && !/--\s*\S/.test(line)) {
      findings.push(
        makeFinding({
          rule: 'type-escapes.lint-suppression',
          category: 'type-escapes',
          severity: 'low',
          message: 'Lint rule disabled without a stated reason.',
          path: ctx.path,
          line: index + 1,
          snippet: raw,
          remediation: 'Add ` -- <reason>` to the directive, or fix the violation.',
        }),
      );
    }
  });

  return findings;
}

export const tsAstDetector: Detector = {
  id: 'ts-ast',
  category: 'error-handling',
  supports: (ctx) => isJsFamily(ctx.language),
  run(ctx): Finding[] {
    let sourceFile: ts.SourceFile;
    try {
      sourceFile = ts.createSourceFile(
        ctx.path,
        ctx.source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(ctx.path),
      );
    } catch {
      // Unparseable input is not a slop signal; leave it to the text detectors.
      return [];
    }

    const findings: Finding[] = [];
    const inTest = isTestPath(ctx.path);
    const isTypeScript = ctx.language === 'typescript';

    let anyCount = 0;
    let firstAny: ts.Node | null = null;

    const visit = (node: ts.Node): void => {
      if (ts.isCatchClause(node)) {
        findings.push(...checkCatchClause(node, sourceFile, ctx));
      }

      if (ts.isCallExpression(node)) {
        findings.push(...checkPromiseCatch(node, sourceFile, ctx));
      }

      if (isTypeScript) {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
          anyCount += 1;
          firstAny ??= node;
        }
        findings.push(...checkDoubleAssertion(node, sourceFile, ctx));
      }

      findings.push(...checkFunction(node, sourceFile, ctx, inTest));

      node.forEachChild(visit);
    };

    sourceFile.forEachChild(visit);

    if (firstAny && anyCount >= 3) {
      findings.push(
        makeFinding({
          rule: 'type-escapes.any',
          category: 'type-escapes',
          severity: anyCount >= 10 ? 'medium' : 'low',
          message: `\`any\` used ${anyCount} times in this file.`,
          path: ctx.path,
          line: lineOf(sourceFile, firstAny),
          snippet: textOf(sourceFile, firstAny),
          remediation:
            'Replace with `unknown` plus narrowing, or write the real interface. Each `any` is a type hole the compiler stops checking.',
        }),
      );
    }

    findings.push(...collectUnusedImports(sourceFile, ctx.path));
    findings.push(...collectSuppressions(ctx));

    if (!inTest && ctx.stats.lines > MAX_FILE_LINES) {
      findings.push(
        makeFinding({
          rule: 'structure.god-file',
          category: 'structure',
          severity: ctx.stats.lines > MAX_FILE_LINES * 2 ? 'medium' : 'low',
          message: `File is ${ctx.stats.lines} lines.`,
          path: ctx.path,
          line: 1,
          snippet: `${ctx.stats.lines} lines`,
          remediation: 'Split along the seams that already exist in the export list.',
        }),
      );
    }

    return findings;
  },
};
