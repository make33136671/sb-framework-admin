# SBAdmin 前端文档

基于 Vben Admin v5.5.9 的企业级管理后台前端项目。

## 快速开始

**环境要求**：Node.js >=20.12.0，pnpm >=10.0.0

```bash
pnpm install
pnpm run dev:antd        # http://localhost:5173
```

## 文档

- **[前端开发指南](./wiki/Frontend_Development.md)** — 项目结构、API 约定、常见问题、部署指南

## 项目信息

| 项           | 值                            |
| ------------ | ----------------------------- |
| **版本**     | v5.5.9 (Vben Admin)           |
| **框架**     | Vue 3.5.24 + TypeScript 5.9.3 |
| **构建**     | Vite (最新版)                 |
| **UI**       | Ant Design Vue 4.2.6          |
| **状态管理** | Pinia 3.0.4                   |
| **路由**     | Vue Router 4.6.3              |

## 支持的 UI 框架

| 框架              | 命令                   |
| ----------------- | ---------------------- |
| Ant Design (推荐) | `pnpm run dev:antd`    |
| Element Plus      | `pnpm run dev:ele`     |
| Naive UI          | `pnpm run dev:naive`   |
| TDesign           | `pnpm run dev:tdesign` |

## 构建命令

```bash
pnpm build           # 构建所有应用
pnpm build:antd      # 构建 Ant Design 版本
pnpm lint            # 运行 ESLint
pnpm format          # 格式化代码
pnpm check:type      # 类型检查
```

## 项目结构

```
sb-admin/
├── apps/
│   ├── web-antd/     # Ant Design 版本
│   ├── web-ele/      # Element Plus 版本
│   ├── web-naive/    # Naive UI 版本
│   └── web-tdesign/  # TDesign 版本
├── packages/         # 共享工具包
├── docs/             # 文档
└── scripts/          # 脚本
```

## 常见问题

**依赖安装失败**：运行 `pnpm clean --del-lock && pnpm install`

**API 404**：确保后端正常运行（http://localhost:6010）

**TypeScript 错误**：运行 `pnpm run check:type`

详细信息见 [前端开发指南](./wiki/Frontend_Development.md#常见问题)

## 相关链接

- [Vben Admin](https://vben.pro/)
- [Vue 3](https://vuejs.org/)
- [Vite](https://vitejs.dev/)
