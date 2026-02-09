// AI Completion Provider
export {
  AICompletionProvider,
  getCompletionProvider,
  useAICompletions,
} from './CompletionProvider';
export type {
  CompletionRequest,
  CompletionResponse,
  CompletionProviderConfig,
} from './CompletionProvider';

// Bug Detector
export { BugDetector, getBugDetector, useBugDetector, bugGlyphStyles } from './BugDetector';
export type { DetectedBug, BugDetectionResult, BugDetectorConfig } from './BugDetector';

// Code Generator
export {
  CodeGenerator,
  getCodeGenerator,
  useCodeGenerator,
  generatorStyles,
} from './CodeGenerator';
export type {
  GenerationMarker,
  GenerationRequest,
  GenerationResult,
  CodeGeneratorConfig,
} from './CodeGenerator';
