import type { Linter } from 'eslint';

import { interopDefault } from '../util';

const rulesCoveredByOxlint = new Set([
  'unicorn/consistent-function-scoping',
  'unicorn/no-process-exit',
  'unicorn/prefer-global-this',
  'unicorn/prefer-module',
]);

export async function unicorn(): Promise<Linter.Config[]> {
  const pluginUnicorn = await interopDefault(import('eslint-plugin-unicorn'));
  const recommendedRules = Object.fromEntries(
    Object.entries(pluginUnicorn.configs.recommended.rules ?? {}).filter(
      ([ruleName]) => !rulesCoveredByOxlint.has(ruleName),
    ),
  );

  return [
    {
      plugins: {
        unicorn: pluginUnicorn,
      },
      rules: {
        ...recommendedRules,

        'unicorn/better-regex': 'off',
        'unicorn/consistent-destructuring': 'off',
        'unicorn/expiring-todo-comments': 'off',
        'unicorn/filename-case': 'off',
        'unicorn/import-style': 'off',
        'unicorn/no-array-for-each': 'off',
        // oxfmt 会把带括号的嵌套三元改写回链式写法，与本规则（要求嵌套三元加括号）互斥；
        // 仓库以 oxfmt 格式为准，故与 oxlint 侧配置保持一致地关闭。
        'unicorn/no-nested-ternary': 'off',
        'unicorn/no-null': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/prefer-at': 'off',
        'unicorn/prefer-dom-node-text-content': 'off',
        'unicorn/prefer-export-from': ['error', { ignoreUsedVariables: true }],
        'unicorn/prefer-top-level-await': 'off',
        'unicorn/prevent-abbreviations': 'off',
      },
    },
  ];
}
