export default {
  plugins: {
    ...(process.env.NODE_ENV === 'production' ? { cssnano: {} } : {}),
    autoprefixer: {},
    // 修复 element-plus 和 ant-design-vue 的样式和tailwindcss冲突问题
    'postcss-antd-fixes': { prefixes: ['ant', 'el'] },
    'postcss-import': {},
    'postcss-preset-env': {},
    // 本仓库用 Tailwind v4 的 CSS-first 配置（@reference "@vben/tailwind-config/theme"），
    // 不存在 JS 配置对象；原先的 config 导入（import config from '.'）恒为 undefined，属 Tailwind v3 遗留，
    // 传入 { config: undefined } 无任何效果，故连同该 import 一并移除。
    tailwindcss: {},
    'tailwindcss/nesting': {},
  },
};
