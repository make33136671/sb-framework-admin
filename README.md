# SB Framework Admin

> 赛博科技自研前端基座 — 基于 Vue 3 + Vben Admin，给所有派生应用（PM / ERP / CRM ...）作为前端起点。

## 这是什么

`sb-framework-admin` 是 [Vben Admin](https://github.com/vbenjs/vue-vben-admin) 的赛博科技 fork，添加了基座层定制：

- 接 `sb-framework`（后端基座 NuGet）提供的 Admin / Menu / License / etc. API
- 基础页面（登录 / 用户 / 角色 / 菜单 / 系统设置 / 后台任务 / 授权管理 / etc.）
- 通用组件（TimeTag / AmountDisplay / Upload / TimezoneDisplay / etc.）

## 派生应用怎么用

**fork-based 模式**（派生应用基于本仓库二次开发）：

```bash
# 派生应用初始建仓时
git clone git@192.168.10.241:saibo/framework/sb-framework-admin.git sb-apps-<app>-admin
cd sb-apps-<app>-admin
git remote rename origin upstream
git remote add origin git@192.168.10.241:saibo/apps/sb-apps-<app>-admin.git
git push -u origin main

# 后续保持跟上游同步
git fetch upstream
git merge upstream/main
```

具体合并规则见 [docs/AI_Fork_Guide.md](./docs/AI_Fork_Guide.md)。

## 本地开发

```bash
git clone git@192.168.10.241:saibo/framework/sb-framework-admin.git
cd sb-framework-admin
pnpm install
pnpm dev:antd          # 启动 Ant Design Vue 版本（默认端口 5173）
pnpm build:antd        # 生产构建
```

## 贡献

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

强制规范：
- 颜色不硬编码 — 用 antd v5 cssVar token（兼容暗黑模式）
- 操作入口用实体按钮，不用文字链
- 命名 kebab-case（views 目录） / PascalCase（组件）
- 不写硬编码品牌文案，走 `__APP_INFO__` 配置
- commit message 中文 + Conventional Commits

完整命名规范见 [sb-framework/docs/naming-conventions.md](http://192.168.10.241/saibo/framework/sb-framework/-/blob/main/docs/naming-conventions.md)。

## 文档

- [AI_Conventions.md](./AI_Conventions.md) — 前端编码约定（toast / UI / 颜色 / 时间 / 等）
- [docs/](./docs/) — Vben 原始文档
- [README.vben.md](./README.vben.md) — Vben Admin 原 README（保留供参考）

## License

继承 Vben Admin 原 [LICENSE](./LICENSE)（MIT）+ 赛博科技定制部分专有。
