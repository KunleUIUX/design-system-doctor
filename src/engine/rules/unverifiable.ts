import type { AssetRef } from '../../shared/designSystem';
import type { Finding } from './types';

/**
 * A check that couldn't be evaluated in this file. Never scored and never reported as a pass:
 * Doctor says what it couldn't read instead of guessing.
 */
export function notVerifiable(currentValue: string, reason: string, action: string): Finding {
  return {
    code: 'not-verifiable',
    severity: 'unverifiable',
    message: 'Not verifiable',
    currentValue,
    expectedValue: 'Can’t be checked in this file',
    rationale: reason,
    suggestedAction: action,
  };
}

export const names = (refs: AssetRef[]) => refs.map((r) => `“${r.name}”`).join(', ');
