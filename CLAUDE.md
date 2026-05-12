# CLAUDE.md

This file provides guidance to Claude Code when working with the **sb-admin** repository (Vue 3 / Vben Admin frontend).

## 项目身份

`sb-admin` 是 [sb](../sb-api) 的前端，基于 [Vben Admin](https://github.com/vbenjs/vue-vben-admin) (Vue 3 + Ant Design Vue + Vite)。
端口：6012。代理 `/storage` 到后端 6010、`/api` 到 mock 5320（实际生产由 nginx 反代）。

## 必读

| Doc | What to find |
|-----|-------------|
| **[Conventions](AI_Conventions.md)** | **开发规范 + 已踩过的坑（写代码前必读）**：toast/UI/颜色/时间/命名/路由/longtext/后台任务/系统设置/CloudConfig/构建/Git。本文件是 `sb-api/docs/AI_Conventions.md` 的镜像，前后端规范统一维护在 sb-api，改动请同步两边 |

## 核心提醒（前端开发最容易踩的坑）

### 1. axios 拦截器自动弹 toast
- `apps/web-antd/src/api/request.ts` 在 `code === 0` 自动 `message.success(后端 message)`
- 业务**不要**写 `message.success(...)` / `message.error(...)` 跟 API 调用配对 → 双 toast
- 详见 Conventions §1

### 2. 颜色 token 体系（混合）
- antd 组件内部覆盖 → `var(--ant-color-*)`（只在 antd 作用域有效）
- 自研组件 / 自绘 div → shadcn `:root` token（`hsl(var(--muted))` / `hsl(var(--destructive))` 等）
- **绝对禁止硬编码** `#xxx` / `rgb()` / `red`/`yellow` 这些
- 在自定义 div 用 `var(--ant-color-error)` → **完全透明看不见**！这是一个高频踩坑
- 详见 Conventions §2

### 3. 时间组件
- 用项目自研 `TimeTag` / `TimeProgress`
- 后端 UTC，前端按 `appTimeZone`（从 `/admin/Verification/Status` 拉）格式化
- 详见 Conventions §2

### 4. 品牌资源不硬编码
- 不写"赛博管理系统"等品牌字面量
- 走 `__APP_INFO__.nameCn` / `preferences.app.name`
- vite 已代理 `/storage` 到后端 6010，**不要**保留 `public/storage/` 副本

### 5. Git 提交
- 完成功能/修复 bug 立即 `git add` 显式列文件 + `git commit` + `git push`
- 中文 + Conventional Commit
- 不跳 hooks，不强推 main

### 6. 派生项目漂移审计（必跑）

这是 fork-style 派生模式 — 派生项目改了 upstream 文件 git 不会提醒,长期累积变成"基座漏回流"债务(pm 加的 Monaco/JsonFieldEditor 拖到 nexus 缺漏才发现就是这种)。

**在派生项目里完成一波功能 / 准备 release 前,必跑漂移审计**:

```bash
cd <派生项目 admin 仓库>
./scripts/check-fork-drift.sh
```

输出三类:
- **MODIFIED** — 改了 upstream 已有文件,⚠ 大概率应该回流 framework(否则别的派生项目缺这个 fix)
- **ADDED** — 派生新增,通常业务但**review 一遍排除"通用组件被本地化"** 的情况
- **DELETED** — 派生删除,review upstream 也是否要删

回流方式:`git checkout tmp-upstream/file → push framework/admin → 其它派生 fetch + merge` 或者 cherry-pick 单个 commit。

脚本本身在 framework/admin/scripts/check-fork-drift.sh,派生项目通过 `git fetch upstream && git merge upstream/main` 自动拿到。
