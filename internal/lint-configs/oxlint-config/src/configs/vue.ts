import type { OxlintConfig } from 'oxlint';

const vue: OxlintConfig = {
  rules: {
    // 与 eslint 配置保持一致（internal/lint-configs/eslint-config/src/configs/vue.ts 中
    // 该规则显式设为 off）：Menu 是 menu-ui 组件的既有 name，sub-menu.vue / menu-item.vue /
    // use-menu.ts / use-menu-context.ts 均按 'Menu' 这个 name 做组件树向上查找，改名会破坏解析。
    'vue/no-reserved-component-names': 'off',
    'vue/prefer-import-from-vue': 'error',
  },
};

export { vue };
