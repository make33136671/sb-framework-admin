# 上传组件体系重构设计

| 字段 | 值 |
| --- | --- |
| 日期 | 2026-04-28 |
| 状态 | design（待评审） |
| 作者 | 用户 + Claude |
| 影响范围 | sb-admin（前端组件 + 业务页迁移）、sb-api（后端配置 + endpoint 整合） |
| 起源 | sb-admin issue #1 多组件并发上传混乱 bug 修复后的代码梳理 |

---

## 1. 背景

修复 sb-admin issue #1（"多个 SmartUpload 组件同时上传时进度显示混乱"）期间发现：

- **公共组件 `<SmartUpload>` 全项目零使用**：所有业务页都绕过组件直接调 `useSmartUpload` hook，自己写 `syncState`/`UploadState`/`setInterval` 三件套样板代码。
- **样板代码重复 → bug 入口**：本次 bug 的直接成因正是 `views/deploy/List.vue` 中复制粘贴的样板把多目标并发状态写到了同一个 reactive 对象。
- **"普通上传"零封装**：`avatar-setting.vue`、`SettingRender.vue`、`setup.vue` 等 5+ 处直接调 `uploadFileApi`，loading/error 处理各写一遍。
- **公共组件 API 不够用**：未参数化（accept/maxSize/forceChunk 等）、未暴露 `cancel/pause` 给父组件、不支持 v-model 绑定文件 URL，无法替代手写场景。
- **前端写死阈值**：`DIRECT_THRESHOLD = 10MB` 在前端硬编码，与后端 `UploadConfig` / `ChunkUploadConfig` 不感知联动。

bug 已经修复，但同样的问题会在新业务页继续出现。本次重构目标是**让所有上传场景都通过统一组件接入，消除样板复制**。

---

## 2. 目标

| # | 目标 | 验收 |
| --- | --- | --- |
| G1 | 业务页只通过 3 个公共组件使用上传，不再直接 `useSmartUpload` 写样板 | 全项目搜不到外部对 `useSmartUpload` 的引用，只剩组件内部 |
| G2 | 直传 / 切片 UI 视觉一致 | 同 type 切换上传模式肉眼无差别 |
| G3 | 前端不再硬编码阈值，由后端 `UploadConfig` 驱动 | 调整后端配置可改变前端切片阈值，无需重新发版 |
| G4 | 支持 6 种类型预设（image/images/video/videos/file/files），含预览 / 下载 / 删除交互 | 见 §6 |
| G5 | 上传失败可一键重试 | 见 §10 |
| G6 | 多文件上传**文件维度串行排队**（同时仅 1 个文件在传），单文件内切片仍按 `MaxConcurrent` 多 worker 并发 | 选 N 个文件，同时仅 1 个文件 status=uploading，其它 queued |
| G7 | 三组件 props/emits/slots **完全一致**，业务页可零成本切换 | 业务页改 tag 名即完成切换 |
| G8 | 现有所有业务页迁移到新组件 | 见 §9.2 |
| G9 | 所有公共 API（class/property/method/function/interface 字段）有中文注释 | 代码评审检查 |

---

## 3. 现状评估

### 3.1 现有文件清单

```
api/core/admin.ts              uploadFileApi（直传，单文件，无进度）
api/core/chunkUpload.ts        chunkInitApi / chunkUploadApi / chunkMergeApi / chunkProgressApi
components/SmartUpload/
  ├ index.vue                  公共组件（仅暴露 success/error 事件，全项目无使用）
  └ useSmartUpload.ts          composable（自动选直传/切片，业务页直接消费）

views/_core/profile/avatar-setting.vue   手写 customRequest + uploadFileApi
views/system-setting/SettingRender.vue   同上（系统设置 ImageUpload/MultiImageUpload/FileUpload 三种 DisplayType）
views/_core/setup/setup.vue              安装向导（logo 等）
views/deploy/List.vue                    手写 useSmartUpload + syncState + setInterval（本次 bug 源）
views/_core/upload-stress/index.vue      bug 复现/回归测试页（dev only）
```

### 3.2 已识别问题

| # | 问题 | 后果 |
| --- | --- | --- |
| P1 | `<SmartUpload>` 公共组件 API 不足 | 业务页绕过组件，重复造轮子 |
| P2 | 样板三件套（`syncState`/`UploadState`/`setInterval`）在多处重复 | 改一处难推广，bug 易复发 |
| P3 | 普通直传零组件封装 | loading/error/进度展示参差不齐 |
| P4 | 前端阈值 `DIRECT_THRESHOLD` 写死 | 后端策略调整需要前端发版 |
| P5 | `UploadConfig` 与 `ChunkUploadConfig` 在后端是两个独立配置类，含字段重叠（`AllowedExtensions` / `MaxFileSizeMB`） | 维护成本高，前端拉两份 |
| P6 | 后端上传 API 路径分散（`/admin/Admin/Upload` 直传、`/admin/ChunkUpload/*` 切片） | 命名不一致，前端 API 文件分散 |
| P7 | 后端返回值缺 `size` 字段 | 业务页需要在前端从 File 对象读 size，秒传/续传场景拿不到 |

### 3.3 已修复（不在本次范围内）

- `views/deploy/List.vue` 多目标并发 state 互覆盖 → 已改为 per-target state
- `useSmartUpload.cancel` 调 `resetState` 清除 `isCancelled` 标记 → 已修复

---

## 4. 需求确认（与用户讨论结果）

| 编号 | 决定 |
| --- | --- |
| 顶层入口 | 提供 3 个并列公共组件：`<DirectUpload>`（强制直传）、`<ChunkUpload>`（强制切片）、`<SmartUpload>`（自动按 `ChunkThresholdMB` 选） |
| props 一致性 | K1：三组件共享同一份 props/emits/slots，业务页切换组件只需改 tag 名 |
| v-model 形态 | A1 + H2：单文件 `string`、多文件 `string[]`，存**相对路径**（如 `/storage/uploads/abc.png`） |
| 完整元数据获取 | `@change` 事件参数 `detail` 含 `{fileName, absfileName, name, size}`（多文件为数组） |
| 文件类型预设 | type 枚举：`image \| images \| video \| videos \| file \| files` |
| accept 默认 | `image*`：浏览器原生 `image/*`；`video*`：`video/*`；`file*`：`*` |
| accept 优先级 | props.accept > 后端 `AllowedExtensions` > type 默认 |
| maxCount 默认 | 单文件 = 1，多文件 = 无限制（业务用 props 限） |
| 多文件并发 | 排队（同时仅 1 个上传） |
| 切片并发线程数 | J3：后端 `MaxConcurrent` 配置 + props 可覆盖，默认 4 |
| 删除按钮语义 | G1：上传中点删除 = 取消 + 移除列表项；已完成点删除 = 仅移除（不调后端真删） |
| 失败重试 | I1：失败列表项显示红框 + 错误信息 + "重试"按钮 |
| 预览 | 图片用 antd `<Image>` preview-group；视频用弹窗 `<video controls autoplay>` |
| 下载 | 直接 `<a :href :download>` 跳走 |
| 后端配置 | 合并 `UploadConfig` 与 `ChunkUploadConfig` 为单一 `UploadConfig`；阈值/扩展名等从 appsettings.json 读 |
| 后端 endpoint 路径 | 统一前缀 `/admin/Upload/`，新增 `GET /admin/Upload/Config` 暴露给前端 |
| 后端返回值 | `Direct` 与 `ChunkMerge` 统一返回 `{fileName, absfileName, name, size}` |
| 现有调用方 | 全部迁移到新组件，删除 `uploadFileApi` |
| 代码规范 | 所有 public class / property / method / function / interface 字段加中文注释 |

---

## 5. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│ 业务页（迁移目标）                                              │
│   avatar-setting / SettingRender / setup / deploy / ...        │
└────────────────────────┬─────────────────────────────────────┘
                         │ 只用三个公共组件
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ 组件层（公共，三个并列）                                         │
│   <DirectUpload>      <ChunkUpload>      <SmartUpload>         │
│   强制直传           强制切片            自动选                  │
│      │                  │                   │                  │
│      └──────────┬───────┴───────────────────┘                  │
│                 │ 共享 UI 模板 + 排队消费器                      │
└─────────────────┼────────────────────────────────────────────┘
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 内部模块（components/Upload/internal/）                         │
│   UploadUi.vue         默认 UI 模板（按 type 渲染 6 种布局）      │
│   useUploadQueue.ts    多文件排队消费器                          │
│   useDirectUpload.ts   单文件直传 hook                          │
│   useChunkUpload.ts    单文件切片 hook                          │
│   useUploadConfig.ts   拉后端 config 单例缓存                    │
│   types.ts             共享类型                                 │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ API 层（统一前缀 /admin/Upload/）                                │
│   GET  /admin/Upload/Config                                    │
│   POST /admin/Upload/Direct                                    │
│   POST /admin/Upload/ChunkInit | ChunkUpload | ChunkMerge       │
│   GET  /admin/Upload/ChunkProgress                              │
└──────────────────────────────────────────────────────────────┘
```

### 关键设计要点

- **三组件共享同一套 props/emits/slots**：通过 `defineProps` 抽到 `internal/types.ts` 中的 `UploadProps` 类型，三个 `.vue` 文件 `defineProps<UploadProps>()` 引用同一定义。
- **`<SmartUpload>` 不重写逻辑**：内部按每个 `File` 大小选用 `useDirectUpload` 或 `useChunkUpload`，UI 复用 `<UploadUi>`。
- **UI 完全抽到 `<UploadUi>`**：三组件的 `<template>` 都只是 `<UploadUi v-bind="..." :run-upload="...">`，把 file 投递回调注入即可，保证视觉一致。
- **配置拉取单例缓存**：`useUploadConfig()` 用模块级 `ref` 缓存第一次拉取的结果，应用周期内不再重复请求。

---

## 6. 组件 API 设计

### 6.1 props（三组件共用）

| 名 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `value`（v-model） | `string \| string[]` | `''` / `[]` | 文件相对路径（如 `/storage/uploads/abc.png`），多文件时为数组 |
| `type` | `'image' \| 'images' \| 'video' \| 'videos' \| 'file' \| 'files'` | `'file'` | 决定默认 UI 与 accept 默认值 |
| `maxCount` | `number` | 单 = 1，多 = `Infinity` | 文件数量上限（含已存在 + 上传中） |
| `maxConcurrent` | `number` | 后端配置 / 4 | 切片并发线程数（仅 `<ChunkUpload>` / `<SmartUpload>` 切片场景生效） |
| `accept` | `string` | type 默认 | 浏览器选择对话框的 accept；不设则按 §4 优先级 fallback |
| `disabled` | `boolean` | `false` | 禁用所有交互 |

### 6.2 emits（三组件共用）

| 事件 | 参数 | 触发时机 |
| --- | --- | --- |
| `update:value` | `string \| string[]`（相对路径） | v-model 双向同步：成功 / 删除 / 重试都会触发 |
| `change` | `UploadDetail \| UploadDetail[]` | v-model 同时机；`detail` 含 `{fileName, absfileName, name, size}` |
| `success` | 同 `change` 但**仅在新文件刚上传成功瞬间**触发，不含删除 | 用于"上传完成做点事"，如 avatar-setting 调 `changeAvatarApi` |
| `error` | `Error` | 上传失败、网络中断、后端返回非 0 code |

### 6.3 slots（三组件共用）

| 名 | scope | 说明 |
| --- | --- | --- |
| `default` | `{ items, addFiles, cancel, retry, remove }` | **完全自定义** UI，default slot 提供时 `<UploadUi>` 不渲染 |
| `extra` | 同上 | 在默认 UI 旁追加内容（说明文字、自定义按钮等） |

### 6.4 暴露方法（`defineExpose`）

| 方法                            | 说明                           |
| ------------------------------- | ------------------------------ |
| `cancelAll(): void`             | 取消所有进行中的上传项         |
| `clear(): void`                 | 清空整个列表（含已完成）       |
| `addFiles(files: File[]): void` | 程序化添加文件（绕过点击选择） |

### 6.5 共享类型

```typescript
/** 上传成功后回传给业务的元数据 */
export interface UploadDetail {
  /** 服务端相对路径（同 v-model:value 字符串） */
  fileName: string;
  /** 服务端绝对 URL（含 host） */
  absfileName: string;
  /** 原始文件名 */
  name: string;
  /** 文件字节数 */
  size: number;
}

/** 内部维护的列表项（不对外暴露，但可通过 default slot scope 拿到） */
export interface UploadItem {
  /** 内部唯一 id */
  uid: string;
  /** 当前状态 */
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  /** 进度 0-100 */
  progress: number;
  /** 用户选择的本地 File（done 后保留以便重试） */
  file?: File;
  /** 服务端返回的相对路径（done 后才有） */
  fileName?: string;
  /** 服务端返回的绝对 URL */
  absfileName?: string;
  /** 显示用文件名（File.name 或从 URL 解析） */
  name: string;
  /** 字节数（File.size 或后端返回） */
  size?: number;
  /** 失败时的错误 message */
  error?: string;
}

export interface UploadProps {
  value?: string | string[];
  type?: 'image' | 'images' | 'video' | 'videos' | 'file' | 'files';
  maxCount?: number;
  maxConcurrent?: number;
  accept?: string;
  disabled?: boolean;
}
```

---

## 7. 数据流

### 7.1 初始化（页面打开 v-model 已有值）

```
v-model.value = ['/storage/uploads/abc.png', '/storage/uploads/xyz.mp4']
        ↓
组件 watch(value, immediate=true)
        ↓
对每个 URL 创建 UploadItem：
  fileName = URL
  absfileName = (config.urlPrefix || window.location.origin) + URL
  name = URL.split('/').pop().split('?')[0]
  size = undefined（UI 显示 "--"）
  status = 'done'
        ↓
items 数组就绪，UploadUi 渲染缩略图 / 列表项
```

### 7.2 上传新文件

```
用户选 N 个文件（点击 / 拖拽 / addFiles 程序化）
        ↓
对每个 file 检查类型、大小、maxCount → 不通过则 message.error 不入队
        ↓
通过的 file push UploadItem (status='queued')
        ↓
useUploadQueue 消费：检测 items.some(i => i.status === 'uploading') === false 时取下一个 queued
        ↓
按组件类型选 hook：
  <DirectUpload>: useDirectUpload(file)
  <ChunkUpload>:  useChunkUpload(file)
  <SmartUpload>:  file.size > config.chunkThreshold ? useChunkUpload : useDirectUpload
        ↓
hook 内部上传，progress 实时更新到 item
        ↓
成功：写入 fileName/absfileName/name/size，status='done'
       emit('success', detail), emit('change', allDetail), emit('update:value', allFileNames)
        ↓
触发下一个 queued
```

### 7.3 删除（G1 语义）

```
用户点删除按钮
  if item.status === 'uploading':
    调用 hook.cancel() → worker 退出 → 等 Promise 抛"已取消"
    从 items 移除
  else:
    直接从 items 移除
        ↓
emit('change') 同步 v-model
```

### 7.4 重试（I1）

```
item.status === 'error' 且 item.file 仍存在
        ↓
点"重试" → 重置 item (status='queued', progress=0, error=undefined)
        ↓
useUploadQueue 检测到新 queued，从消费器入口走"上传新文件流程"下半段
```

### 7.5 cancelAll / clear

- `cancelAll()`：遍历 items，对 `status === 'uploading'` 调 hook.cancel；不动 items 数组
- `clear()`：先 `cancelAll()` 再清空 items 并 emit 空数组

---

## 8. 后端改造（sb-api）

### 8.1 配置合并（`SB.Core/AppSettings.cs`）

删除 `ChunkUploadConfig` 类，全部并入 `UploadConfig`：

```csharp
/// <summary>
/// 上传相关配置（直传 + 切片统一）
/// </summary>
public class UploadConfig
{
    /// <summary>文件大小上限（MB），超过即拒绝</summary>
    public long MaxFileSizeMB { get; set; } = 2048;

    /// <summary>切片阈值（MB），超过此大小走切片，小于等于走直传</summary>
    public int ChunkThresholdMB { get; set; } = 10;

    /// <summary>每片大小（MB）</summary>
    public int ChunkSizeMB { get; set; } = 1;

    /// <summary>切片上传的并发线程数（前端默认值）</summary>
    public int MaxConcurrent { get; set; } = 4;

    /// <summary>上传文件最终落盘目录（相对 wwwroot）</summary>
    public string UploadPath { get; set; } = "/storage/uploads/";

    /// <summary>切片临时目录（相对 wwwroot）</summary>
    public string ChunkTempPath { get; set; } = "/storage/chunks/";

    /// <summary>未完成切片上传的过期小时数</summary>
    public int ChunkExpireHours { get; set; } = 24;

    /// <summary>允许的文件扩展名（小写，含点，如 .jpg），空数组表示不限制</summary>
    public List<string> AllowedExtensions { get; set; } = new();

    /// <summary>调试限速：分片上传接口每片人为延迟（毫秒），仅 dev 用</summary>
    public int DebugThrottleMs { get; set; } = 0;
}
```

`appsettings.json` / `appsettings.Development.json` 同步：删 `ChunkUploadConfig` 顶层 key，新字段并入 `UploadConfig`。

### 8.2 路径统一 — 合并为单个 `UploadController`

| 新路径 | 原路径 | 变化 |
| --- | --- | --- |
| `GET /admin/Upload/Config` | — | 新增 |
| `POST /admin/Upload/Direct` | `/admin/Auth/Upload`（位于 AuthController，调 FileUploadService） | 重命名并迁移到新 UploadController；FileUploadService 保留或合入 UploadService |
| `POST /admin/Upload/ChunkInit` | `/admin/ChunkUpload/Init` | 重命名 |
| `POST /admin/Upload/ChunkUpload` | `/admin/ChunkUpload/Upload` | 重命名 |
| `POST /admin/Upload/ChunkMerge` | `/admin/ChunkUpload/Merge` | 重命名 |
| `GET /admin/Upload/ChunkProgress` | `/admin/ChunkUpload/Progress` | 重命名 |

- 删除 `ChunkUploadController`
- 新建 `UploadController`，所有 endpoint 集中
- `ChunkUploadService` **保留**（业务逻辑无变化），仅注入路径变化
- 内部 `AppGlobal.AppSettings.ChunkUploadConfig.X` 全部替换为 `AppGlobal.AppSettings.UploadConfig.X`

### 8.3 配置 endpoint 返回 DTO

```csharp
/// <summary>
/// 上传配置（前端拉取，应用生命周期内只读一次）
/// </summary>
public class UploadConfigDto
{
    /// <summary>文件大小上限（MB）</summary>
    public long MaxFileSizeMB { get; set; }
    /// <summary>切片阈值（MB），超过则走切片</summary>
    public int ChunkThresholdMB { get; set; }
    /// <summary>切片并发线程数推荐值</summary>
    public int MaxConcurrent { get; set; }
    /// <summary>允许的扩展名列表（小写，含点）</summary>
    public List<string> AllowedExtensions { get; set; }
    /// <summary>URL 前缀（host with scheme），用于前端拼绝对 URL</summary>
    public string UrlPrefix { get; set; }
}
```

### 8.4 返回值统一加 `size` + `name`

`Direct` 端点：

```csharp
return Result.Success("上传成功", new {
    fileName = relativePath,
    absfileName = $"{host}{relativePath}",
    name = file.FileName,
    size = file.Length
});
```

`ChunkMerge` 端点：从 `SB_ChunkUpload.FileSize`（已存在字段）读 size，从 `FileName` 读原始名（已存在字段）。

### 8.5 中文注释规范

所有新增 / 修改的 public 类型 / 属性 / 方法补 `/// <summary>` 注释，参数补 `/// <param>` 注释。

---

## 9. 文件结构与迁移

### 9.1 新建文件

```
sb-admin/apps/web-antd/src/components/Upload/
  ├ DirectUpload.vue
  ├ ChunkUpload.vue
  ├ SmartUpload.vue
  ├ index.ts                       export 3 个公共组件
  └ internal/
      ├ UploadUi.vue                公用 UI 模板
      ├ useDirectUpload.ts          单文件直传 hook
      ├ useChunkUpload.ts           单文件切片 hook
      ├ useUploadQueue.ts           多文件排队消费器
      ├ useUploadConfig.ts          配置拉取单例缓存
      └ types.ts                    UploadProps / UploadDetail / UploadItem

sb-admin/apps/web-antd/src/api/core/upload.ts   统一上传 API（替代 chunkUpload.ts）
```

### 9.2 业务页迁移清单

| 文件 | 现状 | 迁移目标 |
| --- | --- | --- |
| `views/_core/profile/avatar-setting.vue` | 手写 customRequest + uploadFileApi | `<DirectUpload type="image" v-model:value="form.avatar" @success="onUploaded">` |
| `views/system-setting/SettingRender.vue` | DisplayType 6/17/18 各自手写 | 6 ImageUpload → `<DirectUpload type="image">`；17 MultiImageUpload → `<DirectUpload type="images">`；18 FileUpload → `<DirectUpload type="files">` |
| `views/_core/setup/setup.vue` | 安装向导（logo 等） | `<DirectUpload type="image">` |
| `views/deploy/List.vue` | 手写 useSmartUpload + syncState 三件套 | `<ChunkUpload type="file">` 替代 API/项目两块；删除手写 syncState、UploadState、setInterval |
| `views/_core/upload-stress/index.vue` | 测试页面用 useSmartUpload | 改用 `<ChunkUpload>`，验证多组件并发 + 取消 + 重试 |

### 9.3 删除清单

| 文件 / 符号 | 原因 |
| --- | --- |
| `components/SmartUpload/` 整目录 | 被 `components/Upload/` 替代 |
| `api/core/admin.ts` 的 `uploadFileApi` 函数 | 内部封装在 `useDirectUpload` 中，不再对外 |
| `api/core/chunkUpload.ts` | 改名 `api/core/upload.ts`，整合切片+直传+config |
| `SB.API/Controllers/ChunkUploadController.cs` | 合入 `UploadController` |

### 9.4 数据迁移

数据库存的旧 URL：

- 现有惯例：业务页保存的是**绝对 URL**（如 `http://x.com/storage/uploads/abc.png`）
- 新组件 v-model 是**相对路径**

**迁移策略**：

- 不写 SQL 迁移脚本（每张表的字段名各异，写脚本风险高）
- 业务页迁移到新组件时，在初始化处加一次性兼容逻辑：

```typescript
// 兼容旧绝对 URL：strip 域名转相对
const stripHost = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');
form.avatar = stripHost(rawDataFromBackend.avatar);
```

后续新增数据用相对路径写入，老数据展示无错。等所有业务页都迁完，下一阶段再决定是否做数据库回填迁移。

---

## 10. 错误处理

| 场景 | 处理 |
| --- | --- |
| 文件类型不符（accept 不通过） | 选文件阶段拦截，`message.error('不支持的文件类型: xxx')`，不入队 |
| 文件超过 `MaxFileSizeMB` | 选文件阶段拦截，`message.error('文件超过 X MB 限制')` |
| 多文件超 `maxCount` | 选文件阶段拦截，`message.error('最多 N 个文件')` |
| 网络中断 | item.status='error', error='网络错误'；列表项显示红框 + 重试按钮 |
| 后端返回非 0 code | item.status='error', error=后端 message |
| 切片合并失败（部分分片缺失） | item.status='error', error='合并失败'；点重试时**复用 uploadId 续传缺失分片** |
| 用户取消 | item.status='cancelled' → 直接从列表移除（不显示 error） |
| `useUploadConfig` 拉取失败 | `console.warn` + 用 props 默认值兜底，不阻塞使用 |
| 浏览器关闭 / 刷新 | 现有 chunkInit 秒传 + 续传机制保留：相同 MD5 文件再次上传时，后端检测到未完成的 uploadId 自动断点续传 |

---

## 11. 测试策略

| 层级 | 内容 |
| --- | --- |
| 手动 | `/test/upload-stress` 页面：3 组件并发上传 + 取消 + 重试 + 删除（覆盖核心交互） |
| 单元 | `useUploadQueue` 排队逻辑（mock useDirectUpload）— 逻辑独立，值得写 |
| E2E | 暂不做（投入产出比） |

`useUploadQueue` 单元测试要点：

- 入队 N 个文件，验证同时只有 1 个 uploading，其它为 queued
- 第一个完成后，第二个自动开始
- 中途 cancel 一个，剩下的继续
- 失败一个，不影响后续
- 重试一个失败的，重新入队执行

---

## 12. 代码规范

### 12.1 后端 C#

所有 public class / property / method 用 XML doc 注释：

```csharp
/// <summary>
/// 初始化分片上传（含秒传检测、断点续传、新建会话三种返回）
/// </summary>
/// <param name="fileName">原始文件名</param>
/// <param name="fileSize">文件大小（字节）</param>
/// <param name="fileMd5">文件内容 MD5（小写 32 位）</param>
/// <returns>状态 + uploadId + 已上传分片列表</returns>
public Result Init(string fileName, long fileSize, string fileMd5) { ... }
```

### 12.2 前端 TypeScript / Vue

所有 export function / export const / export interface 字段用 JSDoc：

```typescript
/**
 * 多文件上传排队消费器
 * 同时仅 1 个上传中，前一个完成后自动消费下一个 queued
 */
export function useUploadQueue(
  items: Ref<UploadItem[]>,
  runUpload: (item: UploadItem) => Promise<void>,
) {
  // ...
}

/** 上传成功后回传给业务的元数据 */
export interface UploadDetail {
  /** 服务端相对路径 */
  fileName: string;
  // ...
}
```

内部私有函数若名字已自解释（如 `clearTimer`、`getNext`）可省略；复杂逻辑必须加。

### 12.3 提交风格

- 中文 + Conventional Commit：`feat(upload): ...` / `refactor(upload): ...`
- 显式列出 `git add` 的文件（不用 `-A` / `.`）
- 涉及 sb-api + sb-admin 两个仓库的，分别 commit + push

---

## 13. 风险与兼容性

| 风险 | 缓解 |
| --- | --- |
| 后端 endpoint 路径变更，已发版的客户端 404 | 项目目前只有内部使用的 admin 端，不存在外部 client；上线前确保前后端同时部署 |
| 数据库存的旧绝对 URL 无法直接 v-model 接 | 业务页迁移时加 `stripHost` 兼容，老数据展示无错 |
| 用户业务页正在编辑表单时切换到新组件，行为差异（如 success 事件参数变） | 全部业务页迁移列在 §9.2，逐个测试，不漏 |
| `useUploadConfig` 配置拉取阻塞首次上传 | 单例缓存 + 默认值 fallback，拉取失败不阻塞 |
| 三组件 props 一致性长期维护 | 通过 `internal/types.ts` 共享 `UploadProps` 类型，编译期校验 |

---

## 14. 不在本期范围

- 数据库已有 URL 字段的回填迁移（绝对 → 相对）
- 后端文件真正的删除 API（仅前端列表层面移除）
- 上传文件的访问权限控制（沿用现有 wwwroot 静态托管）
- WebSocket / SSE 实时进度推送（继续用 XHR 上传 progress 回调）
- 大文件直接上传到对象存储（OSS/S3）的旁路通道
- 使用 IndexedDB 暂存断点续传的文件 hash 加速本地秒传
- 移动端拍照/相册的 input capture 适配（type 默认即可，未来视需要扩展）
