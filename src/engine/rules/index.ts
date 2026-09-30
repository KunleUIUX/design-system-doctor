import { colorRule } from './color';
import { detachedComponentRule, duplicateComponentRule } from './components';
import { radiusRule, spacingRule } from './scale';
import type { AuditRule } from './types';
import { typographyRule } from './typography';

export const ALL_RULES: AuditRule[] = [
  typographyRule,
  colorRule,
  detachedComponentRule,
  duplicateComponentRule,
  spacingRule,
  radiusRule,
];
