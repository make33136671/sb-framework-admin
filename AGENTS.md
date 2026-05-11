# AGENTS.md

This document provides guidelines for AI agents working in this codebase.

## Project Overview

Vue Vben Admin is a Vue 3 monorepo using pnpm workspaces, turbo, TypeScript, and Vite. It supports multiple UI frameworks (Ant Design, Element Plus, Naive UI, TDesign).

**Primary Business Logic**: `apps/web-antd/` - 主要业务逻辑实现目录

The monorepo structure includes:

- `apps/`: Application entry points (web-antd, web-ele, web-naive, web-tdesign)
  - `web-antd/`: **主要业务逻辑实现目录** - Ant Design 实现，包含所有业务功能
- `packages/@core/`: Core shared packages
- `packages/@vben/`: Shared utilities, types, locales, styles, etc.
- `internal/`: Internal build tools and configurations

## Build, Lint, and Test Commands

### Core Commands

```bash
# Install dependencies (pnpm is required)
pnpm install

# Development
pnpm dev                           # Run all apps in dev mode
pnpm dev:antd                      # Run Ant Design app only
pnpm dev:ele                       # Run Element Plus app only
pnpm dev:naive                     # Run Naive UI app only
pnpm dev:tdesign                   # Run TDesign app only
pnpm dev:docs                      # Run documentation
pnpm dev:play                      # Run playground

# Build
pnpm build                         # Build all apps
pnpm build:analyze                 # Build with bundle analysis
pnpm build:antd                    # Build Ant Design app only
pnpm build:ele                     # Build Element Plus app only
pnpm build:naive                   # Build Naive UI app only
pnpm build:tdesign                 # Build TDesign app only
pnpm build:docs                    # Build documentation
pnpm build:play                    # Build playground

# Linting and Formatting
pnpm lint                          # Run all linters
pnpm format                        # Auto-format code with Prettier
pnpm check                         # Run all checks (type, circular deps, dependencies, cspell)

# Testing
pnpm test:unit                     # Run unit tests with Vitest
pnpm test:unit -- --run            # Run unit tests once (no watch mode)
pnpm test:unit -- <file>           # Run specific test file
pnpm test:unit -- --testNamePattern="test name"  # Run specific test by name
pnpm test:e2e                      # Run E2E tests with Playwright

# Type Checking
pnpm check:type                    # Type check all packages
# Or per app:
cd apps/web-antd && pnpm typecheck

# Dependency Management
pnpm update:deps                   # Update dependencies
pnpm reinstall                     # Clean and reinstall dependencies
pnpm clean                         # Clean build artifacts
```

### Single Test File Execution

```bash
# Run a specific test file
pnpm test:unit -- src/helper/__tests__/example.test.ts

# Run tests matching a pattern
pnpm test:unit -- --testNamePattern="generateMenus"

# Run tests with coverage
pnpm test:unit -- --coverage

# Run in CI mode (no watch)
pnpm test:unit -- --run
```

### Commit Commands

```bash
# Interactive commit with guided prompts
pnpm commit

# Check circular dependencies
pnpm check:circular

# Check for dependency issues
pnpm check:dep

# Check spelling
pnpm check:cspell
```

## Code Style Guidelines

### TypeScript

- **Strict Mode**: Always enable strict TypeScript checks
- **Type Inference**: Prefer type inference over explicit types where clear
- **Explicit Types**: Required for function parameters and return types, especially in public APIs
- **No `any`**: Avoid `any`; use `unknown` or more specific types instead
- **Interfaces vs Types**: Use interfaces for object shapes that may be extended; use types for unions, intersections, or primitives

```typescript
// Good
interface User {
  id: number;
  name: string;
}

type Status = 'pending' | 'active' | 'inactive';

// Bad
interface User {
  id: any;
  name: any;
}
```

### Naming Conventions

- **Files**: Use kebab-case for component files (`my-component.vue`), PascalCase for components (`MyComponent.vue`), kebab-case for utilities (`generate-menus.ts`)
- **Variables**: camelCase (`const userName = ''`)
- **Constants**: SCREAMING_SNAKE_CASE for config constants (`const MAX_RETRIES = 3`)
- **Classes/Promises**: PascalCase (`class UserService {}`)
- **Booleans**: Use prefix `is`, `has`, `should` (`isVisible`, `hasPermission`)
- **Vue Components**: PascalCase in templates (`<MyComponent />`)

### Imports

- **Absolute Imports**: Use path aliases defined in tsconfig (`#/*` for app src, `@vben/*` for shared packages)
- **Relative Imports**: Use relative imports for same-package dependencies
- **Import Order**:
  1. Node.js built-in imports
  2. External package imports
  3. Internal package imports (absolute)
  4. Relative imports

```typescript
import { ref, computed } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import { filterTree, mapTree } from '@vben-core/shared/utils';
import { $t } from '#/locales';
import { useUserStore } from './stores';
```

### Vue Composition API

- Use `<script setup lang="ts">` for Vue 3 components
- Use composables with `use` prefix (`useCounter`, `useAuth`)
- Destructure props with `defineProps<{...}>()` syntax
- Use `ref` for primitives, `reactive` for objects (or `ref` with objects too)
- Use `computed` for derived state

```typescript
<script setup lang="ts">
interface Props {
  title: string;
  count?: number;
}

const props = withDefaults(defineProps<Props>(), {
  count: 0,
});

const emit = defineEmits<{
  (e: 'update', value: number): void;
}>();

const localCount = ref(props.count);
</script>
```

### Error Handling

- Use `try/catch` with async/await, always handle errors
- Throw `Error` objects with descriptive messages
- Use custom error types for specific error categories
- Never log secrets or sensitive data

```typescript
// Good
async function fetchUser(id: number) {
  try {
    const response = await api.get(`/users/${id}`);
    return response.data;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error(`Failed to fetch user ${id}: ${error.message}`);
  }
}
```

### Async/Await

- Use `async/await` over raw promises
- Handle errors with try/catch
- Use `Promise.all()` for parallel operations when appropriate

```typescript
// Good
async function initializeApp() {
  await Promise.all([loadPreferences(), loadUserData(), loadSettings()]);
}

// Bad (sequential when could be parallel)
async function initializeApp() {
  await loadPreferences();
  await loadUserData();
  await loadSettings();
}
```

### Formatting (Prettier)

- Print width: 80 characters
- Single quotes: Yes
- Semicolons: Yes
- Trailing commas: All
- End of line: Auto

```bash
# Auto-format files
pnpm format
```

### ESLint Rules

The project uses a comprehensive ESLint configuration including:

- TypeScript rules (`@typescript-eslint`)
- Vue rules (`eslint-plugin-vue`)
- Import rules (`import-plugin`)
- Testing rules (`test`)
- Performance/perfectionist rules
- Security rules

```bash
# Run linter
pnpm lint
```

### Stylelint

- Uses `@vben/stylelint-config` with Tailwind CSS plugin
- Scoped styles preferred; use Tailwind for utility classes

```bash
# Lint styles
pnpm lint  # Includes stylelint
```

### Git Commit Messages

Follow Conventional Commits with Chinese/English support:

```
type(scope): subject

body (optional)

footer (optional)
```

**Types**: `feat`, `fix`, `perf`, `style`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`, `revert`, `types`

**Example**:

```
feat(menu): add dynamic menu generation

- Support for nested route menus
- Add order sorting capability
- Compatible with all UI frameworks

Closes #123
```

Use `pnpm commit` for interactive commit prompts.

### Component Patterns

- Use functional props with TypeScript interfaces
- Default props using `withDefaults()`
- Use slots for extensibility
- Export components as named exports

```typescript
// Button.vue
interface ButtonProps {
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: 'primary',
  disabled: false,
});
```

### Directory Structure

```
apps/
  web-antd/                    # Ant Design implementation
    src/
      api/                     # API definitions
      views/
        menu/                  # 菜单管理功能
          api.ts               # API 接口
          Form.vue             # 表单组件
          List.vue             # 列表组件
          Tree.vue             # 树形组件
          table-data.ts        # 表格数据
          menu/                # 子菜单功能模块
      locales/                 # i18n 国际化文件
        index.ts               # 国际化配置入口
        langs/                 # 语言包目录
          en-US/               # 英文语言包
            demos.json         # 示例翻译
            page.json          # 页面翻译
            system-menu.json   # 系统菜单翻译
          zh-CN/               # 中文语言包
            demos.json         # 示例翻译
            guanliyuan.json    # 管理员翻译
            menu.json          # 菜单翻译
            page.json          # 页面翻译
            system.json        # 系统翻译
            system-menu.json   # 系统菜单翻译
            yonghu.json        # 用户翻译
      layouts/                 # Layout components
      router/                  # Route definitions
      store/                   # Pinia stores
packages/
  @vben/                       # Shared packages
    constants/                 # Global constants
    locales/                   # i18n 国际化核心包
      src/
        i18n.ts                # i18n 实例配置
        index.ts               # 导出函数
        typing.ts              # 类型定义
        langs/                 # 核心语言包
          en-US/               # 英文核心语言包
            authentication.json # 认证相关翻译
            common.json         # 通用翻译（返回、登录、禁用等）
            preferences.json    # 首选项翻译
            ui.json             # UI组件翻译（表单验证、操作消息等）
          zh-CN/               # 中文核心语言包
            authentication.json # 认证相关翻译
            common.json         # 通用翻译
            preferences.json    # 首选项翻译
            ui.json             # UI组件翻译
    stores/                    # Shared stores
    styles/                    # Global styles
    types/                     # TypeScript types
    utils/                     # Utility functions
internal/
  lint-configs/                # ESLint, Prettier, Stylelint configs
  tsconfig/                    # TypeScript configs
  vite-config/                 # Vite configurations
```

### Internationalization (i18n)

#### 多语言文件结构

**应用层 (apps/web-antd/src/locales)**:

- 应用特有翻译，如页面标题、业务术语
- 按语言分目录：`en-US/`、`zh-CN/`

**共享包层 (packages/locales)**:

- 核心翻译，所有应用共享
- 包含 `common.json`（通用）、`ui.json`（UI组件）、`authentication.json`（认证）、`preferences.json`（首选项）

#### 使用方式

```typescript
// 在 Vue 组件中使用
import { $t } from '#/locales';

// 翻译键格式
$t('common.cancel'); // 通用翻译
$t('ui.actionTitle.create'); // UI组件翻译
$t('system.menu.name'); // 系统菜单翻译
```

### Monorepo Dependency Rules

- `@vben/*` packages can depend on `@vben/*` and `@vben-core/*`
- `@vben-core/*` packages cannot depend on `@vben/*`
- `@vben-core/shared` cannot depend on any external `@vben/*` packages
- Apps can import from `@vben/*` packages freely
- Avoid circular dependencies between packages

### File Headers

For new files, no copyright header required. The project doesn't use them.

### Testing with Vitest

- Use `describe()` for test suites
- Use `it()` or `test()` for individual tests
- Use `expect()` for assertions
- Mock Vue components with `vue-test-utils`

```typescript
import { describe, expect, it } from 'vitest';

describe('utility function', () => {
  it('should return expected result', () => {
    expect(fn(input)).toEqual(expected);
  });
});
```

### Environment Variables

- Use `.env.development`, `.env.production`, `.env` files
- Prefix variables with `VITE_` for client-side exposure
- Never commit sensitive values

### Known Tools and Patterns

- **Vue Router**: For routing with dynamic route generation
- **Pinia**: For state management
- **@vueuse/core**: For Vue composition utilities
- **Dynamic imports**: For code splitting (`const { fn } = await import('./module')`)
- **Tree utilities**: Use `@vben-core/shared/utils` for tree operations (`filterTree`, `mapTree`)
