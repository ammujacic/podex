/**
 * Design tokens for consistent spacing, borders, and typography.
 */

export const spacing = {
  none: 0,
  xs: 1,
  sm: 1,
  md: 2,
  lg: 3,
  xl: 4,
} as const;

export const borders = {
  none: undefined,
  single: 'single',
  double: 'double',
  round: 'round',
  bold: 'bold',
  singleDouble: 'singleDouble',
  doubleSingle: 'doubleSingle',
  classic: 'classic',
} as const;

export const icons = {
  // Status indicators
  success: '\u2714', // check mark
  error: '\u2718', // cross
  warning: '\u26A0', // warning triangle
  info: '\u2139', // info circle
  pending: '\u25CB', // empty circle
  inProgress: '\u25CF', // filled circle

  // Navigation
  arrowRight: '\u25B6',
  arrowLeft: '\u25C0',
  arrowUp: '\u25B2',
  arrowDown: '\u25BC',
  chevronRight: '\u203A',
  chevronLeft: '\u2039',

  // UI elements
  bullet: '\u2022',
  dash: '\u2500',
  verticalLine: '\u2502',
  corner: '\u2514',
  tee: '\u251C',

  // Pod indicators
  cloud: '\u2601',
  local: '\u2B22', // hexagon

  // Agent status
  thinking: '\u2299', // circled dot
  executing: '\u25B7', // play
  idle: '\u25CB', // empty circle

  // Misc
  star: '\u2605',
  heart: '\u2665',
  lightning: '\u26A1',
} as const;

export const animation = {
  // Timing in milliseconds
  fast: 100,
  normal: 200,
  slow: 500,

  // Spinner frames
  spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],

  // Dots animation
  dotsFrames: ['.', '..', '...', ''],
} as const;

export type Spacing = typeof spacing;
export type Borders = typeof borders;
export type Icons = typeof icons;
export type Animation = typeof animation;
