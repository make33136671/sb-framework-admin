# 贡献 sb-framework-admin

> 本仓库是**前端基座** — 所有派生应用 fork 它。**任何能进基座的代码都会传染所有派生项目**，所以严格。

## 1. 基座代码三不准

| 禁止 | 检查机制 |
|------|---------|
| **不准引入派生业务** — 基座代码（`apps/web-antd/src/views/_system/` 等基座目录）中不允许出现派生项目专有 view（Project / Requirement / TaskItem / 等） | CI |
| **不准硬编码颜色 / 品牌** — `#fff` `rgb(...)` 类十六进制色禁用；走 antd token 或 `__APP_INFO__` | CI（lint） |
| **不准用 `<a>` / 文字链做操作入口** — 用 antd 实体按钮 | Code Review |

## 2. PR 必经流程

1. **从 main 拉分支**：`feature/<short>` / `fix/<short>`
2. **本地通过**：`pnpm install && pnpm build:antd`
3. **lint pass**：`pnpm lint`（CI 自动跑）
4. **提交规范**：中文 Conventional Commits（`feat(layout): xxx` / `fix(menu): xxx`）
5. **MR 描述按模板填写**
6. **至少 1 个 approver**（CODEOWNERS 自动指派）

## 3. 命名规范

- **views 目录**：`kebab-case` 复数 — `projects/` / `requirements/` / `mind-maps/`（不要 `project` 单数）
- **组件文件**：`PascalCase.vue` — `TimeTag.vue` / `AmountDisplay.vue`
- **组件目录**：`PascalCase/` — `RequirementCells/InfoCell.vue`
- **路由 path**：`kebab-case` — `/projects` / `/admin-roles`

## 4. 颜色 / 样式规范

**禁止硬编码颜色** — 一律用 antd v5 cssVar token：

| 用途 | Token |
|------|-------|
| 容器背景 | `var(--ant-color-bg-container)` |
| 次级填充 | `var(--ant-color-fill-secondary)` |
| 警告色 | `var(--ant-color-warning-bg)` / `--ant-color-warning-text` |
| 文字 | `var(--ant-color-text)` / `--ant-color-text-secondary` |
| 边框 | `var(--ant-color-border)` |

**覆盖第三方组件内部样式**：`:deep(.xxx) > 子元素 + !important`（如 antd Table 行背景必须 `:deep(.row-class) > td !important`）。

**状态色优先用 prop**：`<Tag color="warning">` / `<Alert type="warning">`，不要外部 CSS 覆盖。

**写完颜色 CSS 主动切暗黑模式肉眼检查一遍** — 亮模式可读、暗模式吃掉就是硬编码错误。

## 5. 派生业务怎么办

派生业务（PM / ERP / CRM ...）的 view / api / component **不在本仓库**。如果你写 view 涉及"项目 / 需求 / 订单"等具体业务概念，应该在派生仓库（`saibo/apps/sb-apps-<app>-admin`），不是这里。

## 6. 跟随上游 Vben Admin

本仓库是 Vben Admin 的 fork。如要合并上游 Vben 新功能：
```bash
git remote add vben https://github.com/vbenjs/vue-vben-admin.git
git fetch vben
git merge vben/main
```

冲突优先保留 saibo 定制内容。

## 7. 不允许的 commit

- 直推 main
- 跳过 lint / build
- 提交 `node_modules` / `dist` / `.env.local`
- 在 commit message 用占位符
