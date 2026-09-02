# SBAdmin Wiki 文档

## 文档

- **[前端开发指南](./Frontend_Development.md)** — 项目结构、API 约定、常见问题、部署

## 快速开始

```bash
pnpm install
pnpm run dev:antd        # http://localhost:5173
```

## 技术栈

- Vue 3.5.24 + TypeScript 5.9.3
- Vite (最新) + Ant Design Vue 4.2.6
- Pinia 3.0.4 + Vue Router 4.6.3
- Vben Admin v5.5.9

## UI 框架

| 框架              | 命令                   |
| ----------------- | ---------------------- |
| Ant Design (推荐) | `pnpm run dev:antd`    |
| Element Plus      | `pnpm run dev:ele`     |
| Naive UI          | `pnpm run dev:naive`   |
| TDesign           | `pnpm run dev:tdesign` |

## 常见问题

**API 404**：检查后端是否运行（http://localhost:6010）

**表单绑定失败**：确保数据结构与 schema 匹配

**TypeScript 错误**：运行 `pnpm run check:type`

详细答案见 [前端开发指南](./Frontend_Development.md#常见问题)
