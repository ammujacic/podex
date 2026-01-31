/**
 * Podex ASCII logo with gradient effect.
 */

import { Box, Text } from 'ink';
import gradient from 'gradient-string';
import { colors } from '../../theme';

// Pre-defined ASCII art logo (figlet "PODEX" with ANSI Shadow font style)
const LOGO_FULL = `
  ██████╗  ██████╗ ██████╗ ███████╗██╗  ██╗
  ██╔══██╗██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝
  ██████╔╝██║   ██║██║  ██║█████╗   ╚███╔╝
  ██╔═══╝ ██║   ██║██║  ██║██╔══╝   ██╔██╗
  ██║     ╚██████╔╝██████╔╝███████╗██╔╝ ██╗
  ╚═╝      ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝`;

// Large logo for login screen - bigger and bolder
const LOGO_LARGE = `
  ███████████   █████████   ██████████   ██████████ █████ █████
  ░░███░░░░░███ ███░░░░░███ ░░███░░░░███ ░░███░░░░░█░░███ ░░███
   ░███    ░███░███    ░███  ░███   ░░███ ░███  █ ░  ░░███ ███
   ░██████████ ░███    ░███  ░███    ░███ ░██████     ░░█████
   ░███░░░░░░  ░███    ░███  ░███    ░███ ░███░░█      ███░███
   ░███        ░░███   ███   ░███    ███  ░███ ░   █  ███ ░░███
   █████        ░░░█████░    ██████████   ██████████ █████ █████
  ░░░░░          ░░░░░░     ░░░░░░░░░░   ░░░░░░░░░░ ░░░░░ ░░░░░ `;

const LOGO_COMPACT = `▓▓ PODEX`;

const LOGO_MINIMAL = `◈ PODEX`;

// Podex gradient (purple to cyan)
const podexGradient: (text: string) => string = gradient([
  colors.primary.purple,
  colors.primary.purpleLight,
  colors.secondary.cyan,
]);

export type LogoVariant = 'full' | 'compact' | 'minimal' | 'large';

export interface LogoProps {
  variant?: LogoVariant;
  showTagline?: boolean;
  showVersion?: boolean;
  version?: string;
  inverted?: boolean; // Black background with white text
}

export function Logo({
  variant = 'full',
  showTagline = false,
  showVersion = false,
  version = '0.1.0',
  inverted = false,
}: LogoProps) {
  const getLogo = () => {
    switch (variant) {
      case 'full':
        return LOGO_FULL;
      case 'large':
        return LOGO_LARGE;
      case 'compact':
        return LOGO_COMPACT;
      case 'minimal':
        return LOGO_MINIMAL;
      default:
        return LOGO_FULL;
    }
  };

  const logo = getLogo();

  // For inverted mode (login screen), use white text on black background
  if (inverted && variant === 'large') {
    const lines = logo.split('\n');
    const maxWidth = Math.max(...lines.map((l) => l.length));
    const paddedLines = lines.map((line) => line.padEnd(maxWidth));

    return (
      <Box flexDirection="column" alignItems="center">
        <Box
          flexDirection="column"
          paddingX={2}
          paddingY={1}
          borderStyle="round"
          borderColor="white"
        >
          {paddedLines.map((line, index) => (
            <Text key={index} color="white" backgroundColor="black">
              {line}
            </Text>
          ))}
        </Box>
        {showTagline && (
          <Box marginTop={1}>
            <Text color="gray">Code from Anywhere</Text>
          </Box>
        )}
        {showVersion && (
          <Box marginTop={showTagline ? 0 : 1}>
            <Text dimColor>v{version}</Text>
          </Box>
        )}
      </Box>
    );
  }

  const gradientLogo = podexGradient(logo);

  if (variant === 'full' || variant === 'large') {
    return (
      <Box flexDirection="column" alignItems="center">
        <Text>{gradientLogo}</Text>
        {showTagline && (
          <Box marginTop={1}>
            <Text color="gray">Code from Anywhere</Text>
          </Box>
        )}
        {showVersion && (
          <Box marginTop={showTagline ? 0 : 1}>
            <Text dimColor>v{version}</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box>
      <Text>{gradientLogo}</Text>
      {showVersion && <Text dimColor> v{version}</Text>}
    </Box>
  );
}

// Export gradient for reuse
export { podexGradient };
