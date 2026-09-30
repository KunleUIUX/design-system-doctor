import { expect, it } from 'vitest';
import { ALL_RULES } from '../src/engine/rules';
import { RULE_CATALOG } from '../src/shared/ruleCatalog';

it('UI rule catalog matches the engine rules', () => {
  expect(RULE_CATALOG).toEqual(ALL_RULES.map(({ id, name, description }) => ({ id, name, description })));
});
