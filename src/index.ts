export { DETECTORS } from './detectors/index.js';
export { findDuplication, type DuplicationOptions } from './duplication.js';
export { collectGitSignals, gitFindings } from './git.js';
export { buildWaves, renderPlan, type PlanOptions, type Wave } from './plan.js';
export {
  renderBanner,
  showBanner,
  supportsColor,
  type BannerOptions,
  type ShowBannerOptions,
} from './report/banner.js';
export {
  render,
  renderJson,
  renderMarkdown,
  renderSarif,
  renderTerminal,
  type Format,
  type TerminalOptions,
} from './report/index.js';
export { scan, VERSION, type ScanOptions } from './scan.js';
export {
  BASELINE_WEIGHT_PER_KLOC,
  computeScore,
  gradeFor,
  SEVERITY_WEIGHT,
  slopFromDensity,
} from './score.js';
export {
  HOSTS,
  hostSpecs,
  installSkill,
  type Host,
  type HostSpec,
  type InstallOptions,
  type InstallResult,
} from './skill/install.js';
export { RULES_MD, SKILL_MD } from './skill/content.js';
export { cleanupTarget, resolveTarget, SourceError, type ResolveOptions } from './source.js';
export type {
  Category,
  CategoryScore,
  Detector,
  DetectorContext,
  FileStats,
  Finding,
  GitSignals,
  Grade,
  Language,
  ScanReport,
  ScanTarget,
  Score,
  Severity,
} from './types.js';
export { collectFiles, languageOf, measure, type SourceFile, type WalkOptions } from './walk.js';
export { CONFIG_FILENAMES, loadConfig, parseConfig, type UnvibeConfig } from './config.js';
