import type { OxlintConfig } from 'oxlint';

const unicorn: OxlintConfig = {
  rules: {
    'unicorn/consistent-function-scoping': 'off',
    // oxfmt 会把带括号的嵌套三元改写回 `a ? b : c ? d : e` 链式写法，
    // 而本规则要求嵌套三元必须加括号 —— 两者互斥（改完再格式化即复发）。
    // 仓库以 oxfmt 的格式为准（vsh lint 的 --check 关卡、pnpm format 均以 oxfmt 定稿），故关闭。
    'unicorn/no-nested-ternary': 'off',
    'unicorn/no-process-exit': 'error',
    'unicorn/no-single-promise-in-promise-methods': 'off',
    'unicorn/no-useless-spread': 'off',
    'unicorn/prefer-global-this': 'off',
    'unicorn/prefer-module': 'error',
  },
};

export { unicorn };
