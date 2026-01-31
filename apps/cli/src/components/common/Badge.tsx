/**
 * Badge component for status indicators.
 */

import { Text } from 'ink';
import { terminalColors, icons } from '../../theme';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  icon?: boolean;
}

const variantConfig: Record<BadgeVariant, { color: string; icon: string }> = {
  default: { color: terminalColors.muted, icon: icons.bullet },
  success: { color: terminalColors.success, icon: icons.success },
  warning: { color: terminalColors.warning, icon: icons.warning },
  error: { color: terminalColors.error, icon: icons.error },
  info: { color: terminalColors.info, icon: icons.info },
  primary: { color: terminalColors.primary, icon: icons.star },
};

export function Badge({ children, variant = 'default', icon = false }: BadgeProps) {
  const config = variantConfig[variant];

  return (
    <Text color={config.color}>
      {icon && `${config.icon} `}
      {children}
    </Text>
  );
}
