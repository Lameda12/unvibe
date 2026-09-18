import type { Detector } from '../types.js';
import { commentDetector } from './comments.js';
import { genericDetector } from './generic.js';
import { placeholderDetector } from './placeholders.js';
import { testTheaterDetector } from './test-theater.js';
import { tsAstDetector } from './ts-ast.js';

/**
 * Per-file detectors, run in order. Cross-file analysis (duplication) and
 * repo-level analysis (git history) live outside this list.
 */
export const DETECTORS: Detector[] = [
  commentDetector,
  placeholderDetector,
  tsAstDetector,
  genericDetector,
  testTheaterDetector,
];

export {
  commentDetector,
  genericDetector,
  placeholderDetector,
  testTheaterDetector,
  tsAstDetector,
};
