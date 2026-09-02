# 上传组件体系重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把分散的上传逻辑（`uploadFileApi` + `useSmartUpload` + 5+ 处业务页样板）统一为 3 个公共组件（`<DirectUpload>` / `<ChunkUpload>` / `<SmartUpload>`）+ 后端单一 `UploadController` 体系，消除样板复制并改善一致性。

**Architecture:** 三组件共享同一份 props/emits/slots 类型定义（`internal/types.ts`），UI 复用同一个 `<UploadUi>`，逻辑层拆为 `useDirectUpload` / `useChunkUpload` / `useUploadQueue` / `useUploadConfig` 四个 composable。后端合并 `UploadConfig` + `ChunkUploadConfig` 为单一配置，所有上传 endpoint 集中到 `UploadController` 前缀 `/admin/Upload/`。

**Tech Stack:** Vue 3 + TypeScript + ant-design-vue + vitest（前端）；ASP.NET Core 8 + FreeSql（后端）。

**Spec:** `docs/superpowers/specs/2026-04-28-upload-components-redesign-design.md`

---

## 文件结构总览

### 后端 sb-api

```
[Modify] SB.Core/AppSettings.cs                       合并 UploadConfig + ChunkUploadConfig
[Modify] SB.API/appsettings.json                      key 合并
[Modify] SB.API/appsettings.Development.json          key 合并
[Modify] SB.Services/ChunkUploadService.cs            引用 AppSettings.UploadConfig
[Modify] SB.API/Controllers/AuthController.cs         删除 Upload action
[Create] SB.Models/Dto/UploadConfigDto.cs             配置 DTO
[Create] SB.API/Controllers/UploadController.cs       合并 Direct + Chunk* + Config
[Delete] SB.API/Controllers/ChunkUploadController.cs  迁移到 UploadController
```

### 前端 sb-admin

```
[Create] apps/web-antd/src/api/core/upload.ts                              统一 API
[Create] apps/web-antd/src/components/Upload/index.ts                      公共导出
[Create] apps/web-antd/src/components/Upload/DirectUpload.vue
[Create] apps/web-antd/src/components/Upload/ChunkUpload.vue
[Create] apps/web-antd/src/components/Upload/SmartUpload.vue
[Create] apps/web-antd/src/components/Upload/internal/types.ts
[Create] apps/web-antd/src/components/Upload/internal/useUploadConfig.ts
[Create] apps/web-antd/src/components/Upload/internal/useDirectUpload.ts
[Create] apps/web-antd/src/components/Upload/internal/useChunkUpload.ts
[Create] apps/web-antd/src/components/Upload/internal/useUploadQueue.ts
[Create] apps/web-antd/src/components/Upload/internal/UploadUi.vue
[Create] apps/web-antd/src/components/Upload/internal/__tests__/useUploadQueue.test.ts

[Modify] apps/web-antd/src/views/_core/profile/avatar-setting.vue
[Modify] apps/web-antd/src/views/system-setting/SettingRender.vue
[Modify] apps/web-antd/src/views/_core/setup/setup.vue
[Modify] apps/web-antd/src/views/deploy/List.vue
[Modify] apps/web-antd/src/views/_core/upload-stress/index.vue

[Delete] apps/web-antd/src/components/SmartUpload/         整目录
[Delete] apps/web-antd/src/api/core/chunkUpload.ts
[Modify] apps/web-antd/src/api/core/admin.ts               删除 uploadFileApi 函数
```

---

## 关键约定（适用于所有任务）

- 提交：每完成一个 task 立即 `git add <显式文件名> && git commit && git push`，commit message 用中文 + Conventional Commit
- 分仓：sb-api 与 sb-admin 独立 commit，分别 push
- 注释：所有新增的 public class / property / method / function / interface 字段加中文注释（C# 用 `/// <summary>`，TS/Vue 用 `/** */`）
- TDD：纯逻辑 hook（`useUploadQueue`）走 TDD；UI 组件 / 网络 hook 不强制单测，靠 `/test/upload-stress` 手动验证
- 业务页迁移过程中保持新旧并存可工作（直到 Task 30 才删旧）

---

## Task 1：合并后端 UploadConfig（删 ChunkUploadConfig）

**Files:**

- Modify: `SB.Core/AppSettings.cs`

- [ ] **Step 1：替换 `UploadConfig` 类与移除 `ChunkUploadConfig` 类**

打开 `SB.Core/AppSettings.cs`，定位到现有 `public class UploadConfig` 与 `public class ChunkUploadConfig`，把两者整合为单一 `UploadConfig`（删除 `ChunkUploadConfig` 整个类）：

```csharp
/// <summary>
/// 上传相关配置（直传 + 切片统一）
/// </summary>
public class UploadConfig
{
    /// <summary>
    /// 文件大小上限（MB），超过即拒绝
    /// </summary>
    public long MaxFileSizeMB { get; set; } = 2048;

    /// <summary>
    /// 切片阈值（MB）。文件 > 此值走切片上传，&lt;= 此值走直传
    /// </summary>
    public int ChunkThresholdMB { get; set; } = 10;

    /// <summary>
    /// 切片大小（MB）
    /// </summary>
    public int ChunkSizeMB { get; set; } = 1;

    /// <summary>
    /// 切片上传的并发线程数（前端默认值，业务方 props 可覆盖）
    /// </summary>
    public int MaxConcurrent { get; set; } = 4;

    /// <summary>
    /// 上传文件最终落盘目录（相对 wwwroot）
    /// </summary>
    public string UploadPath { get; set; } = "/storage/uploads/";

    /// <summary>
    /// 切片临时目录（相对 wwwroot）
    /// </summary>
    public string ChunkTempPath { get; set; } = "/storage/chunks/";

    /// <summary>
    /// 未完成切片上传的过期小时数
    /// </summary>
    public int ChunkExpireHours { get; set; } = 24;

    /// <summary>
    /// 允许的文件扩展名（小写、含点，如 ".jpg"）；空列表表示不限制
    /// </summary>
    public List<string> AllowedExtensions { get; set; } = new();

    /// <summary>
    /// 调试限速：分片上传接口每片人为延迟（毫秒），&gt; 0 才生效；仅 Development 用
    /// </summary>
    public int DebugThrottleMs { get; set; } = 0;
}
```

定位 `AppSettings` 类内对 `ChunkUploadConfig` 的属性引用：

```csharp
public ChunkUploadConfig ChunkUploadConfig { get; set; } = new();
```

**删除该行**。`UploadConfig` 属性已存在则保持，无则新增：

```csharp
/// <summary>
/// 上传配置
/// </summary>
public UploadConfig UploadConfig { get; set; } = new();
```

- [ ] **Step 2：编译确认**

```bash
cd /Users/tianlong/projects/sb/sb-api
dotnet build SB.Core/SB.Core.csproj 2>&1 | tail -20
```

预期：`Build succeeded`。若有"未引用 ChunkUploadConfig"等错误，记录后留到下一个 task 修复。

- [ ] **Step 3：commit**

```bash
cd /Users/tianlong/projects/sb/sb-api
git add SB.Core/AppSettings.cs
git commit -m "refactor(upload): 合并 UploadConfig + ChunkUploadConfig 为单一配置类

新增 ChunkThresholdMB / MaxConcurrent / DebugThrottleMs 字段，AllowedExtensions
统一来自 UploadConfig。后续 ChunkUploadService 与 appsettings.json 切换引用。"
git push
```

---

## Task 2：appsettings.json 配置 key 合并

**Files:**

- Modify: `SB.API/appsettings.json`
- Modify: `SB.API/appsettings.Development.json`

- [ ] **Step 1：appsettings.json 删除 ChunkUploadConfig key 并把字段并入 UploadConfig**

定位现有：

```jsonc
"UploadConfig": {
    "MaxFileSizeMB": ...,
    "AllowedExtensions": [".jpg", ".png", ...],
    "UploadPath": "/storage/uploads/"
},
"ChunkUploadConfig": {
    "ChunkSizeMB": 1,
    "MaxFileSizeMB": 2048,
    "TempPath": "/storage/chunks/",
    "ExpireHours": 24,
    "AllowedExtensions": []
},
```

替换为：

```jsonc
"UploadConfig": {
    "MaxFileSizeMB": 2048,
    "ChunkThresholdMB": 10,
    "ChunkSizeMB": 1,
    "MaxConcurrent": 4,
    "UploadPath": "/storage/uploads/",
    "ChunkTempPath": "/storage/chunks/",
    "ChunkExpireHours": 24,
    "AllowedExtensions": [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".mp4", ".webm", ".mov", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".rar", ".7z"],
    "DebugThrottleMs": 0
},
```

（`AllowedExtensions` 取原 `UploadConfig` 的值并加上视频/压缩包等默认；具体清单按现状调整）

- [ ] **Step 2：appsettings.Development.json 同步**

定位现有 `ChunkUploadConfig` key（含 `DebugThrottleMs: 1500`），删除该 key；定位 `UploadConfig` key 改为：

```jsonc
"UploadConfig": {
    "MaxFileSizeMB": 2048,
    "ChunkThresholdMB": 10,
    "ChunkSizeMB": 1,
    "MaxConcurrent": 4,
    "UploadPath": "/storage/uploads/",
    "ChunkTempPath": "/storage/chunks/",
    "ChunkExpireHours": 24,
    "AllowedExtensions": [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".mp4", ".webm", ".mov", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".rar", ".7z"],
    "DebugThrottleMs": 1500
}
```

- [ ] **Step 3：commit**

```bash
cd /Users/tianlong/projects/sb/sb-api
git add SB.API/appsettings.json SB.API/appsettings.Development.json
git commit -m "refactor(upload): 配置 key 合并到 UploadConfig

删除 ChunkUploadConfig 顶层 key，新字段 ChunkThresholdMB / MaxConcurrent /
ChunkSizeMB / ChunkTempPath / ChunkExpireHours / DebugThrottleMs 全部并入
UploadConfig。dev 限速 1500ms 保留。"
git push
```

---

## Task 3：ChunkUploadService 改用 UploadConfig

**Files:**

- Modify: `SB.Services/ChunkUploadService.cs`

- [ ] **Step 1：替换全部 `ChunkUploadConfig` 引用**

定位文件中所有 `AppGlobal.AppSettings.ChunkUploadConfig` 替换为 `AppGlobal.AppSettings.UploadConfig`，对应字段名变化：

- `config.TempPath` → `config.ChunkTempPath`
- `config.ExpireHours` → `config.ChunkExpireHours`
- `config.MaxFileSizeMB`、`config.ChunkSizeMB`、`config.AllowedExtensions`、`config.DebugThrottleMs`：字段名不变

具体修改点（Init / Upload / Merge 方法内 `var config = AppGlobal.AppSettings.ChunkUploadConfig`）：

```csharp
// 原
var config = AppGlobal.AppSettings.ChunkUploadConfig;
// 新
var config = AppGlobal.AppSettings.UploadConfig;
```

```csharp
// 原
var tempDir = Path.Combine(Directory.GetCurrentDirectory(), $"wwwroot{config.TempPath}{uploadId}");
// 新
var tempDir = Path.Combine(Directory.GetCurrentDirectory(), $"wwwroot{config.ChunkTempPath}{uploadId}");
```

`DebugThrottleMs`、`MaxFileSizeMB`、`ChunkSizeMB`、`AllowedExtensions` 字段名不变，只需把上层 `ChunkUploadConfig` 改为 `UploadConfig`。

- [ ] **Step 2：编译确认**

```bash
cd /Users/tianlong/projects/sb/sb-api
dotnet build SB.Services/SB.Services.csproj 2>&1 | tail -10
```

预期：`Build succeeded`。

- [ ] **Step 3：手动验证（如 API 在跑）**

如果 dev API 已在运行，重启它（appsettings 改了，需要 reload）。否则跳过：

```bash
cd /Users/tianlong/projects/sb/sb-api
pkill -f "SB.API" 2>/dev/null; sleep 2
SB_LICENSE_KEY_DIR=/Users/tianlong/projects/sb ASPNETCORE_URLS=http://localhost:6010 ASPNETCORE_ENVIRONMENT=Development nohup dotnet run --project SB.API > /tmp/sb-api.log 2>&1 &
```

等 API 起来：

```bash
until lsof -nP -iTCP:6010 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; do sleep 2; done
echo "API ready"
```

测试现有 `/admin/ChunkUpload/Init`（仍存在）一切正常（用浏览器访问 `/test/upload-stress` 上传一个文件验证）。

- [ ] **Step 4：commit**

```bash
cd /Users/tianlong/projects/sb/sb-api
git add SB.Services/ChunkUploadService.cs
git commit -m "refactor(upload): ChunkUploadService 引用切换到 UploadConfig

字段名 TempPath/ExpireHours 改为 ChunkTempPath/ChunkExpireHours，其它字段
名不变。功能行为完全一致。"
git push
```

---

## Task 4：新建 UploadConfigDto

**Files:**

- Create: `SB.Models/Dto/UploadConfigDto.cs`

- [ ] **Step 1：创建文件**

```csharp
namespace SB.Models.Dto
{
    /// <summary>
    /// 上传配置（前端拉取，应用生命周期内只读一次）
    /// </summary>
    public class UploadConfigDto
    {
        /// <summary>
        /// 文件大小上限（MB）
        /// </summary>
        public long MaxFileSizeMB { get; set; }

        /// <summary>
        /// 切片阈值（MB），&gt; 此值走切片
        /// </summary>
        public int ChunkThresholdMB { get; set; }

        /// <summary>
        /// 切片并发线程数推荐值
        /// </summary>
        public int MaxConcurrent { get; set; }

        /// <summary>
        /// 允许的扩展名列表（小写、含点）；空表示不限制
        /// </summary>
        public List<string> AllowedExtensions { get; set; } = new();

        /// <summary>
        /// URL 前缀（带 scheme 与 host），用于前端拼绝对 URL
        /// </summary>
        public string UrlPrefix { get; set; } = "";
    }
}
```

- [ ] **Step 2：编译确认**

```bash
cd /Users/tianlong/projects/sb/sb-api
dotnet build SB.Models/SB.Models.csproj 2>&1 | tail -5
```

预期：`Build succeeded`。

- [ ] **Step 3：commit**

```bash
cd /Users/tianlong/projects/sb/sb-api
git add SB.Models/Dto/UploadConfigDto.cs
git commit -m "feat(upload): 新增 UploadConfigDto

前端通过 GET /admin/Upload/Config 拉取，单例缓存使用。"
git push
```

---

## Task 5：新建 UploadController（含 Config + Direct + Chunk\*）

**Files:**

- Create: `SB.API/Controllers/UploadController.cs`

- [ ] **Step 1：创建 Controller**

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SB.Core;
using SB.Core.Expand;
using SB.Models;
using SB.Models.Dto;
using SB.Services;

namespace SB.API.Controllers
{
    /// <summary>
    /// 上传相关接口（直传 + 切片 + 配置）
    /// </summary>
    [ApiController, Authorize(AuthenticationSchemes = "JwtAdmin"), Route("[controller]/[action]")]
    public class UploadController : Controller
    {
        private readonly FileUploadService _fileUploadService;
        private readonly ChunkUploadService _chunkUploadService;
        private readonly IHttpContextAccessor _httpContextAccessor;

        /// <summary>
        /// 注入直传与切片两个 Service
        /// </summary>
        public UploadController(
            FileUploadService fileUploadService,
            ChunkUploadService chunkUploadService,
            IHttpContextAccessor httpContextAccessor)
        {
            _fileUploadService = fileUploadService;
            _chunkUploadService = chunkUploadService;
            _httpContextAccessor = httpContextAccessor;
        }

        /// <summary>
        /// 获取上传配置（前端启动时拉一次缓存使用）
        /// </summary>
        [HttpGet]
        public Result Config()
        {
            var cfg = AppGlobal.AppSettings.UploadConfig;
            var host = _httpContextAccessor.HttpContext.RequestHostWithScheme();
            return Result.Success(new UploadConfigDto
            {
                MaxFileSizeMB = cfg.MaxFileSizeMB,
                ChunkThresholdMB = cfg.ChunkThresholdMB,
                MaxConcurrent = cfg.MaxConcurrent,
                AllowedExtensions = cfg.AllowedExtensions,
                UrlPrefix = host
            });
        }

        /// <summary>
        /// 直传单个文件（小文件场景）
        /// </summary>
        [HttpPost]
        [RequestSizeLimit(2L * 1024 * 1024 * 1024)]
        public Result Direct(IFormFile file)
        {
            return _fileUploadService.Upload(file);
        }

        /// <summary>
        /// 初始化分片上传：秒传检测 / 断点续传 / 新建会话
        /// </summary>
        [HttpPost]
        public Result ChunkInit([FromForm] string fileName, [FromForm] long fileSize, [FromForm] string fileMd5)
        {
            return _chunkUploadService.Init(fileName, fileSize, fileMd5);
        }

        /// <summary>
        /// 上传单个分片
        /// </summary>
        [HttpPost]
        [RequestSizeLimit(20 * 1024 * 1024)]
        public Result ChunkUpload([FromForm] string uploadId, [FromForm] int chunkIndex, IFormFile chunk)
        {
            return _chunkUploadService.Upload(uploadId, chunkIndex, chunk);
        }

        /// <summary>
        /// 合并所有分片为最终文件
        /// </summary>
        [HttpPost]
        public Result ChunkMerge([FromForm] string uploadId)
        {
            return _chunkUploadService.Merge(uploadId);
        }

        /// <summary>
        /// 查询上传进度（含已上传分片列表）
        /// </summary>
        [HttpGet]
        public Result ChunkProgress(string uploadId)
        {
            return _chunkUploadService.Progress(uploadId);
        }
    }
}
```

- [ ] **Step 2：编译确认**

```bash
cd /Users/tianlong/projects/sb/sb-api
dotnet build SB.API/SB.API.csproj 2>&1 | tail -10
```

预期：`Build succeeded`。

- [ ] **Step 3：手动验证（重启 API + curl Config）**

```bash
pkill -f "SB.API" 2>/dev/null; sleep 2
cd /Users/tianlong/projects/sb/sb-api
SB_LICENSE_KEY_DIR=/Users/tianlong/projects/sb ASPNETCORE_URLS=http://localhost:6010 ASPNETCORE_ENVIRONMENT=Development nohup dotnet run --project SB.API > /tmp/sb-api.log 2>&1 &
until lsof -nP -iTCP:6010 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; do sleep 2; done
```

登录拿 token（手动浏览器登录后 F12 复制 accessToken），然后：

```bash
TOKEN="<贴你的 access token>"
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:6010/admin/Upload/Config" | jq
```

预期：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "maxFileSizeMB": 2048,
    "chunkThresholdMB": 10,
    "maxConcurrent": 4,
    "allowedExtensions": [".jpg", ...],
    "urlPrefix": "http://localhost:6010"
  }
}
```

- [ ] **Step 4：commit**

```bash
cd /Users/tianlong/projects/sb/sb-api
git add SB.API/Controllers/UploadController.cs
git commit -m "feat(upload): 新增 UploadController 整合 Config/Direct/Chunk* 端点

新路径前缀 /admin/Upload/。Direct 复用现有 FileUploadService，Chunk* 复用
ChunkUploadService，无业务逻辑变化，仅 endpoint 路径整合。原
/admin/Auth/Upload 与 /admin/ChunkUpload/* 暂保留供前端过渡使用。"
git push
```

---

## Task 6：FileUploadService.Upload 返回值加 size + name

**Files:**

- Modify: `SB.Services/FileUploadService.cs`

- [ ] **Step 1：检查现状并补 size/name 字段**

打开 `SB.Services/FileUploadService.cs` 找到 `Upload(IFormFile file)` 方法，找到 return 语句。原本可能是：

```csharp
return Result.Success("上传成功", new
{
    fileName = relativePath,
    absfileName = $"{host}{relativePath}"
});
```

改为：

```csharp
return Result.Success("上传成功", new
{
    fileName = relativePath,
    absfileName = $"{host}{relativePath}",
    name = file.FileName,
    size = file.Length
});
```

如该 Service 还没这种返回结构（结构差异较大），按其现状在返回对象中补 `name` 与 `size` 字段即可。

- [ ] **Step 2：编译确认**

```bash
cd /Users/tianlong/projects/sb/sb-api
dotnet build SB.Services/SB.Services.csproj 2>&1 | tail -5
```

预期：`Build succeeded`。

- [ ] **Step 3：commit**

```bash
cd /Users/tianlong/projects/sb/sb-api
git add SB.Services/FileUploadService.cs
git commit -m "feat(upload): Direct 上传返回值加 size + name 字段

便于前端 SmartUpload 在 @change 事件中给业务方完整元数据。"
git push
```

---

## Task 7：ChunkUploadService.Merge 返回值加 size + name

**Files:**

- Modify: `SB.Services/ChunkUploadService.cs`

- [ ] **Step 1：补字段**

定位 `Merge(string uploadId)` 方法两处 `Result.Success(..., new { fileName, absfileName })` return 语句（一处是已合并幂等返回，一处是新合并），都改为：

```csharp
return Result.Success("上传成功", new
{
    fileName = upload.FilePath,        // 或 finalRelativePath，按上下文
    absfileName = $"{host}{upload.FilePath}",
    name = upload.FileName,
    size = upload.FileSize
});
```

注意 ChunkUpload 实体已有 `FileName`（原始文件名）和 `FileSize` 字段（在 SB.Models/ChunkUpload.cs 中），可直接读。两处 return 语句变量名按上下文匹配（`upload.FilePath` 与 `finalRelativePath` 二者其一）。

- [ ] **Step 2：编译确认**

```bash
cd /Users/tianlong/projects/sb/sb-api && dotnet build SB.Services/SB.Services.csproj 2>&1 | tail -5
```

预期：`Build succeeded`。

- [ ] **Step 3：commit**

```bash
cd /Users/tianlong/projects/sb/sb-api
git add SB.Services/ChunkUploadService.cs
git commit -m "feat(upload): ChunkMerge 返回值加 size + name 字段

跟 Direct 端点对齐返回格式。秒传与正常合并两条路径都补字段。"
git push
```

---

## Task 8：删除 ChunkUploadController 与 AuthController.Upload

**Files:**

- Delete: `SB.API/Controllers/ChunkUploadController.cs`
- Modify: `SB.API/Controllers/AuthController.cs`

⚠️ **执行前提**：所有前端调用方已迁移到 `/admin/Upload/*`。本 task 在 Task 27（前端最后一个迁移完成）后执行。先 skip 这一步，等 Task 27 后回来做。

- [ ] **Step 1：删除 ChunkUploadController**

```bash
cd /Users/tianlong/projects/sb/sb-api
rm SB.API/Controllers/ChunkUploadController.cs
```

- [ ] **Step 2：AuthController 删除 Upload action**

定位 `SB.API/Controllers/AuthController.cs` 第 89 行附近：

```csharp
public Result Upload(IFormFile file) => _fileUploadService.Upload(file);
```

删除该方法及其上方的 `[HttpPost]` 等 attribute（可能含若干行）。如该 controller 中 `_fileUploadService` 字段不再被其他方法用，可一并删除字段与构造函数注入；如还在用则保留。

- [ ] **Step 3：编译确认**

```bash
cd /Users/tianlong/projects/sb/sb-api && dotnet build 2>&1 | tail -10
```

预期：`Build succeeded`。

- [ ] **Step 4：commit**

```bash
cd /Users/tianlong/projects/sb/sb-api
git add SB.API/Controllers/ChunkUploadController.cs SB.API/Controllers/AuthController.cs
git commit -m "refactor(upload): 删除 ChunkUploadController + AuthController.Upload

所有前端已切到 /admin/Upload/*，旧 endpoint 不再被引用。FileUploadService
与 ChunkUploadService 均保留，仅 Controller 入口收敛到 UploadController。"
git push
```

---

## Task 9：前端 - 新建 api/core/upload.ts 统一上传 API

**Files:**

- Create: `apps/web-antd/src/api/core/upload.ts`

- [ ] **Step 1：创建文件**

```ts
import { useAccessStore } from '@vben/stores';

import { useAppConfig } from '@vben/hooks';

import { api } from '#/api/request';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

/** 上传成功后回传给业务的元数据 */
export interface UploadDetail {
  /** 服务端相对路径，如 /storage/uploads/abc.png */
  fileName: string;
  /** 服务端绝对 URL（带 host） */
  absfileName: string;
  /** 原始文件名 */
  name: string;
  /** 字节数 */
  size: number;
}

/** GET /admin/Upload/Config 返回值 */
export interface UploadConfigData {
  /** 文件大小上限（MB） */
  maxFileSizeMB: number;
  /** 切片阈值（MB），> 此值走切片 */
  chunkThresholdMB: number;
  /** 切片并发线程数 */
  maxConcurrent: number;
  /** 允许的扩展名列表（小写、含点） */
  allowedExtensions: string[];
  /** URL 前缀（带 scheme 与 host） */
  urlPrefix: string;
}

/** ChunkInit 返回值 */
export interface ChunkInitResult {
  /** 'instant'=秒传 / 'new'=新建 / 'resume'=续传 */
  status: 'instant' | 'new' | 'resume';
  uploadId?: string;
  chunkSize?: number;
  totalChunks?: number;
  uploadedChunks?: number[];
  /** 秒传场景下后端返回 */
  fileName?: string;
  absfileName?: string;
  name?: string;
  size?: number;
}

/**
 * 拉取上传配置（前端缓存使用，参考 useUploadConfig.ts）
 */
export async function getUploadConfigApi(): Promise<UploadConfigData> {
  return api.get('/Upload/Config', { quiet: true });
}

/**
 * 直传文件（小文件场景，由 useDirectUpload 调用）
 */
export async function directUploadApi(file: File): Promise<UploadDetail> {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/Upload/Direct', formData, { quiet: true });
}

/**
 * 初始化分片上传
 */
export async function chunkInitApi(params: {
  fileName: string;
  fileMd5: string;
  fileSize: number;
}): Promise<ChunkInitResult> {
  return api.post('/Upload/ChunkInit', params, { quiet: true });
}

/**
 * 合并分片
 */
export async function chunkMergeApi(uploadId: string): Promise<UploadDetail> {
  return api.post('/Upload/ChunkMerge', { uploadId }, { quiet: true });
}

/**
 * 查询切片上传进度
 */
export async function chunkProgressApi(uploadId: string) {
  return api.get('/Upload/ChunkProgress', { params: { uploadId } });
}

/**
 * 上传单个分片（用 XMLHttpRequest 以支持上传进度回调）
 */
export function chunkUploadApi(
  uploadId: string,
  chunkIndex: number,
  chunk: Blob,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('chunk', chunk);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.code === 0) resolve();
          else reject(new Error(body?.message || '分片上传失败'));
        } catch {
          reject(new Error('响应解析失败'));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.ontimeout = () => reject(new Error('请求超时'));

    const accessStore = useAccessStore();
    const token = accessStore.accessToken;

    xhr.open('POST', `${apiURL}/Upload/ChunkUpload`);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}
```

- [ ] **Step 2：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/api/core/upload.ts
git commit -m "feat(upload): 新增 api/core/upload.ts 统一上传 API

整合 Config / Direct / ChunkInit / ChunkUpload / ChunkMerge / ChunkProgress
六个 endpoint。后续 components/Upload 只引用此文件，旧 chunkUpload.ts 与
admin.ts:uploadFileApi 待全部迁移完后删除。"
git push
```

---

## Task 10：新建 components/Upload/internal/types.ts

**Files:**

- Create: `apps/web-antd/src/components/Upload/internal/types.ts`

- [ ] **Step 1：创建文件**

```ts
/** 上传组件支持的预设类型 */
export type UploadType =
  | 'image'
  | 'images'
  | 'video'
  | 'videos'
  | 'file'
  | 'files';

/** 三组件共用的 props 定义 */
export interface UploadProps {
  /** v-model:value，单文件 string，多文件 string[]，存相对路径 */
  value?: string | string[];
  /** 类型预设 */
  type?: UploadType;
  /** 文件数量上限：单 = 1，多 = Infinity（业务方可覆盖） */
  maxCount?: number;
  /** 切片并发线程数（覆盖后端配置） */
  maxConcurrent?: number;
  /** 浏览器选择对话框 accept；不设按类型默认/后端 allowedExtensions fallback */
  accept?: string;
  /** 禁用所有交互 */
  disabled?: boolean;
}

/** 上传成功后回传给业务的元数据（与后端 UploadDetail 对齐） */
export interface UploadDetail {
  /** 服务端相对路径 */
  fileName: string;
  /** 服务端绝对 URL */
  absfileName: string;
  /** 原始文件名 */
  name: string;
  /** 字节数 */
  size: number;
}

/** 内部维护的列表项（通过 default slot scope 暴露给业务） */
export interface UploadItem {
  /** 内部唯一 id */
  uid: string;
  /** 当前状态 */
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  /** 进度 0-100 */
  progress: number;
  /** 用户选择的本地 File（done 后保留以便重试） */
  file?: File;
  /** 服务端返回的相对路径 */
  fileName?: string;
  /** 服务端返回的绝对 URL */
  absfileName?: string;
  /** 显示名（File.name 或从 URL 解析） */
  name: string;
  /** 字节数 */
  size?: number;
  /** 失败时的错误 message */
  error?: string;
  /** 取消函数（uploading 时由 hook 注入） */
  cancel?: () => void;
}

/** 默认 UI 模板的 slot scope */
export interface UploadSlotScope {
  /** 当前列表 */
  items: UploadItem[];
  /** 程序化添加文件 */
  addFiles: (files: File[]) => void;
  /** 取消单项上传（uploading 时） */
  cancel: (uid: string) => void;
  /** 重试单项（error 时） */
  retry: (uid: string) => void;
  /** 移除单项 */
  remove: (uid: string) => void;
}
```

- [ ] **Step 2：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/components/Upload/internal/types.ts
git commit -m "feat(upload): 新增 Upload 组件共享类型定义

UploadType / UploadProps / UploadDetail / UploadItem / UploadSlotScope。
三组件 defineProps&lt;UploadProps&gt;() 引用同一类型保证一致。"
git push
```

---

## Task 11：新建 useUploadConfig（拉配置单例缓存）

**Files:**

- Create: `apps/web-antd/src/components/Upload/internal/useUploadConfig.ts`

- [ ] **Step 1：创建文件**

```ts
import { ref } from 'vue';

import { getUploadConfigApi } from '#/api/core/upload';

/** 默认配置兜底（后端拉取失败时使用） */
const DEFAULT_CONFIG = {
  maxFileSizeMB: 2048,
  chunkThresholdMB: 10,
  maxConcurrent: 4,
  allowedExtensions: [] as string[],
  urlPrefix: window.location.origin,
};

const cache = ref<typeof DEFAULT_CONFIG | null>(null);
let pending: Promise<typeof DEFAULT_CONFIG> | null = null;

/**
 * 获取上传配置（应用生命周期内只拉一次，并发调用共享同一 Promise）
 */
export function useUploadConfig() {
  /**
   * 同步取当前缓存（可能是 null = 未加载完成；返回兜底默认）
   */
  function get(): typeof DEFAULT_CONFIG {
    return cache.value ?? DEFAULT_CONFIG;
  }

  /**
   * 异步加载配置（只发起一次请求，后续调用复用 Promise）
   */
  async function load(): Promise<typeof DEFAULT_CONFIG> {
    if (cache.value) return cache.value;
    if (pending) return pending;
    pending = (async () => {
      try {
        const data = await getUploadConfigApi();
        cache.value = {
          maxFileSizeMB: data.maxFileSizeMB ?? DEFAULT_CONFIG.maxFileSizeMB,
          chunkThresholdMB:
            data.chunkThresholdMB ?? DEFAULT_CONFIG.chunkThresholdMB,
          maxConcurrent: data.maxConcurrent ?? DEFAULT_CONFIG.maxConcurrent,
          allowedExtensions:
            data.allowedExtensions ?? DEFAULT_CONFIG.allowedExtensions,
          urlPrefix: data.urlPrefix || DEFAULT_CONFIG.urlPrefix,
        };
        return cache.value;
      } catch (e) {
        console.warn('[Upload] 拉取配置失败，使用默认值', e);
        cache.value = { ...DEFAULT_CONFIG };
        return cache.value;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  return { get, load };
}
```

- [ ] **Step 2：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/components/Upload/internal/useUploadConfig.ts
git commit -m "feat(upload): 新增 useUploadConfig 配置拉取单例缓存

模块级 ref 缓存第一次请求结果；后续并发调用共享同一 Promise；拉取失败
回落到默认值（不阻塞使用）。"
git push
```

---

## Task 12：新建 useDirectUpload（单文件直传 hook）

**Files:**

- Create: `apps/web-antd/src/components/Upload/internal/useDirectUpload.ts`

- [ ] **Step 1：创建文件**

```ts
import { ref } from 'vue';

import { useAccessStore } from '@vben/stores';

import { useAppConfig } from '@vben/hooks';

import type { UploadDetail } from './types';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

/**
 * 单文件直传 hook（用 XMLHttpRequest 以支持进度 + 取消）
 *
 * 跟 useChunkUpload 暴露相同形状以便上层统一调度
 */
export function useDirectUpload() {
  /** 上传进度 0-100 */
  const progress = ref(0);
  /** 当前状态 */
  const status = ref<'idle' | 'uploading' | 'done' | 'error' | 'cancelled'>(
    'idle',
  );
  /** 错误信息 */
  const errorMsg = ref('');

  let xhr: XMLHttpRequest | null = null;

  /**
   * 上传单个文件，返回服务端响应（成功）或 throw（失败/取消）
   */
  async function upload(file: File): Promise<UploadDetail> {
    return new Promise((resolve, reject) => {
      progress.value = 0;
      status.value = 'uploading';
      errorMsg.value = '';

      xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          progress.value = Math.round((event.loaded / event.total) * 100);
        }
      };

      xhr.onload = () => {
        if (xhr!.status >= 200 && xhr!.status < 300) {
          try {
            const body = JSON.parse(xhr!.responseText);
            if (body?.code === 0) {
              progress.value = 100;
              status.value = 'done';
              resolve(body.data as UploadDetail);
            } else {
              status.value = 'error';
              errorMsg.value = body?.message || '上传失败';
              reject(new Error(errorMsg.value));
            }
          } catch {
            status.value = 'error';
            errorMsg.value = '响应解析失败';
            reject(new Error(errorMsg.value));
          }
        } else {
          status.value = 'error';
          errorMsg.value = `HTTP ${xhr!.status}`;
          reject(new Error(errorMsg.value));
        }
      };

      xhr.onerror = () => {
        status.value = 'error';
        errorMsg.value = '网络错误';
        reject(new Error(errorMsg.value));
      };

      xhr.onabort = () => {
        status.value = 'cancelled';
        reject(new Error('已取消'));
      };

      const accessStore = useAccessStore();
      const token = accessStore.accessToken;
      xhr.open('POST', `${apiURL}/Upload/Direct`);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
    });
  }

  /**
   * 取消当前上传（abort XHR；onabort 回调会 reject 上传 Promise）
   */
  function cancel() {
    if (xhr) {
      xhr.abort();
      xhr = null;
    }
  }

  return { progress, status, errorMsg, upload, cancel };
}
```

- [ ] **Step 2：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/components/Upload/internal/useDirectUpload.ts
git commit -m "feat(upload): 新增 useDirectUpload 单文件直传 hook

XHR 实现，支持上传进度回调与 abort 取消。返回值与 useChunkUpload 同形
（progress/status/errorMsg/upload/cancel）便于统一调度。"
git push
```

---

## Task 13：新建 useChunkUpload（单文件切片 hook）

**Files:**

- Create: `apps/web-antd/src/components/Upload/internal/useChunkUpload.ts`

- [ ] **Step 1：创建文件**

```ts
import { ref } from 'vue';

import SparkMD5 from 'spark-md5';

import { chunkInitApi, chunkMergeApi, chunkUploadApi } from '#/api/core/upload';

import type { UploadDetail } from './types';

/** 计算文件 MD5（增量分片，不阻塞 UI） */
async function hashFile(
  file: File,
  onProgress?: (p: number) => void,
): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  const chunkSize = 2 * 1024 * 1024;
  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    const buffer = await slice.arrayBuffer();
    spark.append(buffer);
    offset += chunkSize;
    onProgress?.(Math.min(Math.round((offset / file.size) * 100), 100));
  }
  return spark.end();
}

/**
 * 单文件切片上传 hook
 */
export function useChunkUpload(options?: { maxConcurrent?: number }) {
  /** 上传总进度 0-100 */
  const progress = ref(0);
  /** 当前状态 */
  const status = ref<
    | 'idle'
    | 'hashing'
    | 'uploading'
    | 'merging'
    | 'done'
    | 'error'
    | 'cancelled'
  >('idle');
  /** MD5 计算进度 */
  const hashProgress = ref(0);
  /** 错误信息 */
  const errorMsg = ref('');

  let isCancelled = false;
  const maxConcurrent = options?.maxConcurrent ?? 4;

  /**
   * 上传单个文件（计算 MD5 → 初始化 → 并发分片 → 合并）
   */
  async function upload(file: File): Promise<UploadDetail> {
    isCancelled = false;
    progress.value = 0;
    hashProgress.value = 0;
    errorMsg.value = '';

    try {
      status.value = 'hashing';
      const md5 = await hashFile(file, (p) => (hashProgress.value = p));
      if (isCancelled) throw new Error('已取消');

      status.value = 'uploading';
      const init = await chunkInitApi({
        fileName: file.name,
        fileMd5: md5,
        fileSize: file.size,
      });

      // 秒传
      if (init.status === 'instant') {
        progress.value = 100;
        status.value = 'done';
        return {
          fileName: init.fileName!,
          absfileName: init.absfileName!,
          name: init.name ?? file.name,
          size: init.size ?? file.size,
        };
      }

      const uploadId = init.uploadId!;
      const chunkSize = init.chunkSize!;
      const totalChunks = init.totalChunks!;
      const uploaded = new Set(init.uploadedChunks ?? []);

      // 构建待上传队列
      const queue: number[] = [];
      for (let i = 0; i < totalChunks; i++) if (!uploaded.has(i)) queue.push(i);
      let completed = uploaded.size;
      const updateProgress = () => {
        progress.value = Math.round((completed / totalChunks) * 100);
      };
      updateProgress();

      // 并发 worker
      const workers = Array.from({ length: maxConcurrent }, () =>
        (async () => {
          while (queue.length > 0) {
            if (isCancelled) return;
            const idx = queue.shift();
            if (idx === undefined) break;
            const start = idx * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const blob = file.slice(start, end);
            await chunkUploadApi(uploadId, idx, blob);
            completed++;
            updateProgress();
          }
        })(),
      );
      await Promise.all(workers);

      if (isCancelled) throw new Error('已取消');

      status.value = 'merging';
      const merged = await chunkMergeApi(uploadId);
      progress.value = 100;
      status.value = 'done';
      return merged;
    } catch (e: any) {
      if (e?.message === '已取消') {
        status.value = 'cancelled';
      } else {
        status.value = 'error';
        errorMsg.value = e?.message || '上传失败';
      }
      throw e;
    }
  }

  /**
   * 取消上传（worker 在下次 chunk 边界检查标记退出）
   */
  function cancel() {
    isCancelled = true;
  }

  return { progress, status, hashProgress, errorMsg, upload, cancel };
}
```

- [ ] **Step 2：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/components/Upload/internal/useChunkUpload.ts
git commit -m "feat(upload): 新增 useChunkUpload 单文件切片 hook

支持 MD5 秒传/续传、并发 worker（默认 4，maxConcurrent 选项可调）、cancel
标志。返回值与 useDirectUpload 同形（progress/status/errorMsg/upload/cancel）。"
git push
```

---

## Task 14：useUploadQueue 单元测试（TDD）

**Files:**

- Create: `apps/web-antd/src/components/Upload/internal/__tests__/useUploadQueue.test.ts`

- [ ] **Step 1：写测试（先 fail）**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ref, nextTick } from 'vue';

import type { UploadItem } from '../types';
import { useUploadQueue } from '../useUploadQueue';

function makeItem(uid: string): UploadItem {
  return {
    uid,
    status: 'queued',
    progress: 0,
    name: `${uid}.txt`,
  };
}

describe('useUploadQueue', () => {
  it('同时只有一个 uploading，其它保持 queued', async () => {
    const items = ref<UploadItem[]>([
      makeItem('a'),
      makeItem('b'),
      makeItem('c'),
    ]);
    const runUpload = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    useUploadQueue(items, runUpload);
    await nextTick();
    await new Promise((r) => setTimeout(r, 5));

    const uploading = items.value.filter((i) => i.status === 'uploading');
    expect(uploading.length).toBe(1);
  });

  it('第一个完成后第二个自动开始', async () => {
    const items = ref<UploadItem[]>([makeItem('a'), makeItem('b')]);
    const runUpload = vi.fn(async (item: UploadItem) => {
      item.status = 'uploading';
      await new Promise((r) => setTimeout(r, 20));
      item.status = 'done';
    });

    useUploadQueue(items, runUpload);
    await new Promise((r) => setTimeout(r, 60));

    expect(items.value[0]!.status).toBe('done');
    expect(items.value[1]!.status).toBe('done');
  });

  it('一个失败不影响后续', async () => {
    const items = ref<UploadItem[]>([makeItem('a'), makeItem('b')]);
    const runUpload = vi.fn(async (item: UploadItem) => {
      item.status = 'uploading';
      await new Promise((r) => setTimeout(r, 20));
      if (item.uid === 'a') {
        item.status = 'error';
        item.error = 'mocked';
      } else {
        item.status = 'done';
      }
    });

    useUploadQueue(items, runUpload);
    await new Promise((r) => setTimeout(r, 60));

    expect(items.value[0]!.status).toBe('error');
    expect(items.value[1]!.status).toBe('done');
  });

  it('新加入的 queued 项被消费', async () => {
    const items = ref<UploadItem[]>([]);
    const runUpload = vi.fn(async (item: UploadItem) => {
      item.status = 'uploading';
      await new Promise((r) => setTimeout(r, 10));
      item.status = 'done';
    });

    useUploadQueue(items, runUpload);
    items.value.push(makeItem('a'));
    await new Promise((r) => setTimeout(r, 30));
    expect(items.value[0]!.status).toBe('done');
  });
});
```

- [ ] **Step 2：跑测试确认 fail**

```bash
cd /Users/tianlong/projects/sb/sb-admin/apps/web-antd
pnpm vitest run src/components/Upload/internal/__tests__/useUploadQueue.test.ts 2>&1 | tail -20
```

预期：4 个测试全部 fail（找不到 useUploadQueue 模块）。

- [ ] **Step 3：commit 测试（红）**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/components/Upload/internal/__tests__/useUploadQueue.test.ts
git commit -m "test(upload): useUploadQueue 单元测试（红）

覆盖：同时只有一个 uploading、按序消费、失败不影响后续、动态新增项被消费。"
git push
```

---

## Task 15：实现 useUploadQueue

**Files:**

- Create: `apps/web-antd/src/components/Upload/internal/useUploadQueue.ts`

- [ ] **Step 1：实现**

```ts
import { watch, type Ref } from 'vue';

import type { UploadItem } from './types';

/**
 * 多文件排队消费器
 *
 * 监听 items 数组：当没有 status='uploading' 的项时，挑下一个 'queued' 项
 * 调用 runUpload。runUpload 负责把 status 改为 'uploading' / 'done' / 'error'。
 *
 * 同时仅 1 个文件在传（文件维度排队），单个文件内部的并发由 useChunkUpload
 * 自己的 worker 池负责。
 */
export function useUploadQueue(
  items: Ref<UploadItem[]>,
  runUpload: (item: UploadItem) => Promise<void>,
) {
  let processing = false;

  async function tick() {
    if (processing) return;
    const hasUploading = items.value.some((i) => i.status === 'uploading');
    if (hasUploading) return;
    const next = items.value.find((i) => i.status === 'queued');
    if (!next) return;
    processing = true;
    try {
      await runUpload(next);
    } finally {
      processing = false;
      // 立即检查下一个
      tick();
    }
  }

  // 深度监听：状态变化、新项加入都触发
  watch(
    () => items.value.map((i) => `${i.uid}:${i.status}`).join(','),
    () => tick(),
    { immediate: true },
  );
}
```

- [ ] **Step 2：跑测试确认绿**

```bash
cd /Users/tianlong/projects/sb/sb-admin/apps/web-antd
pnpm vitest run src/components/Upload/internal/__tests__/useUploadQueue.test.ts 2>&1 | tail -20
```

预期：4 个测试全部 PASS。若 fail，调试 watch 触发时机或 tick 重入。

- [ ] **Step 3：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/components/Upload/internal/useUploadQueue.ts
git commit -m "feat(upload): 实现 useUploadQueue 排队消费器

watch items 字符串签名，触发 tick 取下一个 queued 项调 runUpload。
processing 字段防重入，文件维度串行（同时仅 1 个上传中）。"
git push
```

---

## Task 16：新建 UploadUi.vue（默认 UI 模板）

**Files:**

- Create: `apps/web-antd/src/components/Upload/internal/UploadUi.vue`

- [ ] **Step 1：创建文件**

```vue
<script lang="ts" setup>
import { computed, ref } from 'vue';

import {
  Button,
  Image,
  Modal,
  Progress,
  Upload,
  message,
} from 'ant-design-vue';

import type { UploadItem, UploadType } from './types';

const props = defineProps<{
  /** 列表项 */
  items: UploadItem[];
  /** 类型预设 */
  type: UploadType;
  /** accept 字符串 */
  accept: string;
  /** 数量上限 */
  maxCount: number;
  /** 是否禁用 */
  disabled: boolean;
}>();

const emit = defineEmits<{
  /** 用户选择文件后触发 */
  pick: [files: File[]];
  /** 取消单项上传 */
  cancel: [uid: string];
  /** 重试单项 */
  retry: [uid: string];
  /** 移除单项 */
  remove: [uid: string];
}>();

/** 是否多文件类型 */
const isMulti = computed(() => /s$/.test(props.type));
/** 是否图片类型 */
const isImage = computed(
  () => props.type === 'image' || props.type === 'images',
);
/** 是否视频类型 */
const isVideo = computed(
  () => props.type === 'video' || props.type === 'videos',
);
/** 是否文件类型 */
const isFile = computed(() => props.type === 'file' || props.type === 'files');

/** 是否还能添加（未达到 maxCount） */
const canAdd = computed(
  () => props.items.length < props.maxCount && !props.disabled,
);

/** 视频预览弹窗 */
const videoPreviewUrl = ref('');
const videoPreviewVisible = ref(false);
function openVideoPreview(url: string) {
  videoPreviewUrl.value = url;
  videoPreviewVisible.value = true;
}

function handleBeforeUpload(file: File) {
  emit('pick', [file]);
  return false; // 阻止 antd 默认上传
}
</script>

<template>
  <div class="upload-ui" :class="`upload-ui--${type}`">
    <!-- 已存在的列表项 -->
    <template v-if="isImage || isVideo">
      <div class="grid">
        <div
          v-for="item in items"
          :key="item.uid"
          class="card card--media"
          :class="{ 'card--error': item.status === 'error' }"
        >
          <!-- 缩略图 -->
          <Image
            v-if="isImage && item.absfileName"
            :src="item.absfileName"
            :width="100"
            :height="100"
            :preview="{ mask: '预览' }"
          />
          <div
            v-else-if="isVideo && item.absfileName"
            class="video-thumb"
            @click="openVideoPreview(item.absfileName!)"
          >
            <video :src="item.absfileName" muted />
            <div class="video-thumb__icon">▶</div>
          </div>
          <!-- 上传中遮罩 -->
          <div
            v-if="item.status === 'uploading' || item.status === 'queued'"
            class="overlay"
          >
            <Progress
              type="circle"
              :percent="item.progress"
              :size="56"
              status="active"
            />
          </div>
          <!-- 错误遮罩 -->
          <div v-if="item.status === 'error'" class="overlay overlay--error">
            <span class="error-text">{{ item.error || '上传失败' }}</span>
          </div>
          <!-- 操作按钮（hover 显示） -->
          <div class="actions">
            <Button
              v-if="item.status === 'uploading'"
              danger
              size="small"
              @click="emit('cancel', item.uid)"
              >取消</Button
            >
            <Button
              v-else-if="item.status === 'error'"
              type="primary"
              size="small"
              @click="emit('retry', item.uid)"
              >重试</Button
            >
            <Button size="small" @click="emit('remove', item.uid)">删除</Button>
          </div>
        </div>
        <!-- + 添加按钮 -->
        <Upload
          v-if="canAdd"
          :show-upload-list="false"
          :before-upload="handleBeforeUpload"
          :accept="accept"
          :multiple="isMulti"
          :disabled="disabled"
        >
          <div class="card card--add">
            <span class="plus">+</span>
            <span class="plus-text">{{
              isImage ? '上传图片' : '上传视频'
            }}</span>
          </div>
        </Upload>
      </div>
    </template>

    <!-- 文件类型 -->
    <template v-if="isFile">
      <div class="file-list">
        <div
          v-for="item in items"
          :key="item.uid"
          class="file-row"
          :class="{ 'file-row--error': item.status === 'error' }"
        >
          <div class="file-icon">📄</div>
          <div class="file-meta">
            <div class="file-name">{{ item.name }}</div>
            <div class="file-sub">
              <span v-if="item.size"
                >{{ (item.size / 1024).toFixed(1) }} KB</span
              >
              <span v-else>--</span>
              <span v-if="item.status === 'error'" class="err">
                · {{ item.error || '上传失败' }}
              </span>
            </div>
            <Progress
              v-if="item.status === 'uploading' || item.status === 'queued'"
              :percent="item.progress"
              size="small"
              status="active"
            />
          </div>
          <div class="file-actions">
            <Button
              v-if="item.status === 'done' && item.absfileName"
              size="small"
              @click="
                () => {
                  const a = document.createElement('a');
                  a.href = item.absfileName!;
                  a.download = item.name;
                  a.click();
                }
              "
              >下载</Button
            >
            <Button
              v-if="item.status === 'uploading'"
              danger
              size="small"
              @click="emit('cancel', item.uid)"
              >取消</Button
            >
            <Button
              v-if="item.status === 'error'"
              type="primary"
              size="small"
              @click="emit('retry', item.uid)"
              >重试</Button
            >
            <Button danger size="small" @click="emit('remove', item.uid)"
              >删除</Button
            >
          </div>
        </div>
        <Upload
          v-if="canAdd"
          :show-upload-list="false"
          :before-upload="handleBeforeUpload"
          :accept="accept"
          :multiple="isMulti"
          :disabled="disabled"
        >
          <Button :disabled="disabled" type="dashed" block> + 上传文件 </Button>
        </Upload>
      </div>
    </template>

    <!-- 视频预览弹窗 -->
    <Modal
      v-model:open="videoPreviewVisible"
      :footer="null"
      width="720px"
      destroy-on-close
    >
      <video
        :src="videoPreviewUrl"
        controls
        autoplay
        style="width: 100%; max-height: 70vh"
      />
    </Modal>
  </div>
</template>

<style scoped>
.upload-ui {
  width: 100%;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.card {
  position: relative;
  width: 100px;
  height: 100px;
  overflow: hidden;
  border: 1px dashed #d9d9d9;
  border-radius: 4px;
  background: #fafafa;
}

.card--add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(0, 0, 0, 0.45);
}

.card--add:hover {
  border-color: #1890ff;
  color: #1890ff;
}

.card--error {
  border-color: #ff4d4f;
}

.plus {
  font-size: 24px;
  line-height: 1;
}

.plus-text {
  font-size: 12px;
  margin-top: 4px;
}

.video-thumb {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.video-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-thumb__icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  border-radius: 50%;
}

.overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}

.overlay--error {
  background: rgba(255, 77, 79, 0.85);
  color: white;
  font-size: 12px;
  padding: 4px;
  text-align: center;
}

.error-text {
  word-break: break-all;
}

.actions {
  position: absolute;
  bottom: 4px;
  left: 4px;
  right: 4px;
  display: flex;
  gap: 4px;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.card:hover .actions {
  opacity: 1;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
}

.file-row--error {
  border-color: #ff4d4f;
}

.file-icon {
  font-size: 24px;
}

.file-meta {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-sub {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  margin-top: 2px;
}

.file-sub .err {
  color: #ff4d4f;
}

.file-actions {
  display: flex;
  gap: 4px;
}
</style>
```

- [ ] **Step 2：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/components/Upload/internal/UploadUi.vue
git commit -m "feat(upload): 新增 UploadUi 公用 UI 模板

按 type 渲染 image/images/video/videos/file/files 6 种默认布局。图片/视频
用方形卡片网格 + 缩略图 + hover 操作；文件用横条卡片列表。预览：图片
antd Image 自带，视频弹窗 video controls。"
git push
```

---

## Task 17：新建 SmartUpload.vue / DirectUpload.vue / ChunkUpload.vue

**Files:**

- Create: `apps/web-antd/src/components/Upload/SmartUpload.vue`
- Create: `apps/web-antd/src/components/Upload/DirectUpload.vue`
- Create: `apps/web-antd/src/components/Upload/ChunkUpload.vue`

- [ ] **Step 1：SmartUpload.vue**

```vue
<script lang="ts" setup>
import { computed, onMounted, ref, toRefs, watch } from 'vue';

import { message } from 'ant-design-vue';

import UploadUi from './internal/UploadUi.vue';
import { useChunkUpload } from './internal/useChunkUpload';
import { useDirectUpload } from './internal/useDirectUpload';
import { useUploadConfig } from './internal/useUploadConfig';
import { useUploadQueue } from './internal/useUploadQueue';
import type {
  UploadDetail,
  UploadItem,
  UploadProps,
  UploadSlotScope,
} from './internal/types';

defineOptions({ name: 'SmartUpload' });

const props = withDefaults(defineProps<UploadProps>(), {
  value: () => '' as any,
  type: 'file',
  maxConcurrent: 0,
  accept: '',
  disabled: false,
});

const emit = defineEmits<{
  'update:value': [v: string | string[]];
  change: [d: UploadDetail | UploadDetail[]];
  success: [d: UploadDetail | UploadDetail[]];
  error: [e: Error];
}>();

defineSlots<{
  /** 完全自定义 UI；不提供时用 UploadUi */
  default?: (scope: UploadSlotScope) => any;
  /** 在默认 UI 旁追加内容 */
  extra?: (scope: UploadSlotScope) => any;
}>();

/** 是否多文件类型 */
const isMulti = computed(() => /s$/.test(props.type ?? 'file'));
/** 实际 maxCount（单 = 1，多 = 默认 Infinity） */
const effectiveMaxCount = computed(() => {
  if (props.maxCount && props.maxCount > 0) return props.maxCount;
  return isMulti.value ? Infinity : 1;
});

/** 配置 */
const cfg = useUploadConfig();
onMounted(() => cfg.load());

/** 实际 accept（props > 后端 > 类型默认） */
const effectiveAccept = computed(() => {
  if (props.accept) return props.accept;
  const list = cfg.get().allowedExtensions;
  if (list?.length) return list.join(',');
  if (props.type?.startsWith('image')) return 'image/*';
  if (props.type?.startsWith('video')) return 'video/*';
  return '*';
});

/** 内部列表 */
const items = ref<UploadItem[]>([]);

/** 解析 v-model 初始值为 items（status=done） */
function syncFromValue(v: string | string[]) {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const existingFileNames = new Set(
    items.value.filter((i) => i.fileName).map((i) => i.fileName),
  );
  const incoming: UploadItem[] = [];
  for (const url of list) {
    if (existingFileNames.has(url)) continue;
    const name = url.split('/').pop()?.split('?')[0] || url;
    const prefix = cfg.get().urlPrefix;
    incoming.push({
      uid: `init-${url}`,
      status: 'done',
      progress: 100,
      fileName: url,
      absfileName: prefix + url,
      name,
    });
  }
  // 用 v-model 重置（去掉非 done 的，保留 done 与 incoming）
  items.value = [
    ...items.value.filter((i) => list.includes(i.fileName ?? '')),
    ...incoming,
  ];
}

watch(
  () => props.value,
  (v) => syncFromValue(v as any),
  { immediate: true },
);

/** 把 items 转成 v-model 值 + detail */
function emitChange() {
  const dones = items.value.filter((i) => i.status === 'done');
  if (isMulti.value) {
    const fileNames = dones.map((i) => i.fileName!);
    const details: UploadDetail[] = dones.map((i) => ({
      fileName: i.fileName!,
      absfileName: i.absfileName!,
      name: i.name,
      size: i.size!,
    }));
    emit('update:value', fileNames);
    emit('change', details);
  } else {
    const first = dones[0];
    emit('update:value', first?.fileName ?? '');
    if (first) {
      emit('change', {
        fileName: first.fileName!,
        absfileName: first.absfileName!,
        name: first.name,
        size: first.size!,
      });
    }
  }
}

/** 决定单文件走哪个 hook */
function pickHook(file: File) {
  const threshold = cfg.get().chunkThresholdMB * 1024 * 1024;
  return file.size > threshold ? 'chunk' : 'direct';
}

/** 校验文件 */
function validate(file: File): string | null {
  const accept = effectiveAccept.value;
  if (
    accept &&
    accept !== '*' &&
    !accept.startsWith('image/') &&
    !accept.startsWith('video/')
  ) {
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
    const accepted = accept.split(',').map((s) => s.trim().toLowerCase());
    if (!accepted.includes(ext)) return `不支持的文件类型: ${ext}`;
  }
  const maxBytes = cfg.get().maxFileSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return `文件超过 ${cfg.get().maxFileSizeMB} MB 限制`;
  }
  return null;
}

/** 添加文件入队 */
function addFiles(files: File[]) {
  for (const file of files) {
    if (items.value.length >= effectiveMaxCount.value) {
      message.error(`最多 ${effectiveMaxCount.value} 个文件`);
      break;
    }
    const err = validate(file);
    if (err) {
      message.error(err);
      continue;
    }
    items.value.push({
      uid: `new-${Date.now()}-${Math.random()}`,
      status: 'queued',
      progress: 0,
      file,
      name: file.name,
      size: file.size,
    });
  }
}

/** 排队消费器：同时仅 1 个上传 */
useUploadQueue(items, async (item) => {
  if (!item.file) return;
  const useChunk = pickHook(item.file);
  const hook =
    useChunk === 'chunk'
      ? useChunkUpload({
          maxConcurrent: props.maxConcurrent || cfg.get().maxConcurrent,
        })
      : useDirectUpload();

  item.status = 'uploading';
  item.cancel = () => hook.cancel();

  // 进度桥接
  const stop = watch(hook.progress, (p) => (item.progress = p));

  try {
    const detail = await hook.upload(item.file);
    item.status = 'done';
    item.fileName = detail.fileName;
    item.absfileName = detail.absfileName;
    item.size = detail.size;
    item.name = detail.name || item.name;
    emit('success', detail);
    emitChange();
  } catch (e: any) {
    if (e?.message === '已取消') {
      // 静默：cancel/remove 已经处理 UI
    } else {
      item.status = 'error';
      item.error = e?.message || '上传失败';
      emit('error', e instanceof Error ? e : new Error(String(e)));
    }
  } finally {
    stop();
  }
});

/** Slot 暴露的方法 */
function cancel(uid: string) {
  const it = items.value.find((i) => i.uid === uid);
  it?.cancel?.();
  // 取消后从列表移除（G1 语义）
  items.value = items.value.filter((i) => i.uid !== uid);
  emitChange();
}

function retry(uid: string) {
  const it = items.value.find((i) => i.uid === uid);
  if (!it || !it.file) return;
  it.status = 'queued';
  it.progress = 0;
  it.error = undefined;
}

function remove(uid: string) {
  const it = items.value.find((i) => i.uid === uid);
  if (it?.status === 'uploading') {
    it.cancel?.();
  }
  items.value = items.value.filter((i) => i.uid !== uid);
  emitChange();
}

/** 暴露给父组件 */
defineExpose({
  /** 取消所有进行中的上传 */
  cancelAll() {
    items.value
      .filter((i) => i.status === 'uploading')
      .forEach((i) => i.cancel?.());
  },
  /** 清空整个列表 */
  clear() {
    items.value
      .filter((i) => i.status === 'uploading')
      .forEach((i) => i.cancel?.());
    items.value = [];
    emitChange();
  },
  /** 程序化添加 */
  addFiles,
});

const slotScope = computed<UploadSlotScope>(() => ({
  items: items.value,
  addFiles,
  cancel,
  retry,
  remove,
}));
</script>

<template>
  <slot v-if="$slots.default" v-bind="slotScope" />
  <template v-else>
    <UploadUi
      :items="items"
      :type="props.type ?? 'file'"
      :accept="effectiveAccept"
      :max-count="effectiveMaxCount"
      :disabled="props.disabled ?? false"
      @pick="addFiles"
      @cancel="cancel"
      @retry="retry"
      @remove="remove"
    />
    <slot name="extra" v-bind="slotScope" />
  </template>
</template>
```

- [ ] **Step 2：DirectUpload.vue**

```vue
<script lang="ts" setup>
/**
 * 强制直传（小文件场景）
 *
 * 内部即 SmartUpload 强制 mode='direct'：复用 SmartUpload 但绕过阈值判断
 * 始终走 useDirectUpload。简化实现：直接复用 SmartUpload 并加 prop 标志。
 */
import SmartUpload from './SmartUpload.vue';
import type { UploadProps } from './internal/types';

defineOptions({ name: 'DirectUpload' });

const props = defineProps<UploadProps>();
const emit = defineEmits<{
  'update:value': [v: string | string[]];
  change: [d: any];
  success: [d: any];
  error: [e: Error];
}>();
</script>

<template>
  <SmartUpload
    v-bind="props"
    force-mode="direct"
    @update:value="(v: any) => emit('update:value', v)"
    @change="(d: any) => emit('change', d)"
    @success="(d: any) => emit('success', d)"
    @error="(e: any) => emit('error', e)"
  >
    <template v-if="$slots.default" #default="scope">
      <slot v-bind="scope" />
    </template>
    <template v-if="$slots.extra" #extra="scope">
      <slot name="extra" v-bind="scope" />
    </template>
  </SmartUpload>
</template>
```

- [ ] **Step 3：ChunkUpload.vue**

跟 DirectUpload.vue 完全相同结构，仅 `force-mode="direct"` 改为 `"chunk"`：

```vue
<script lang="ts" setup>
/**
 * 强制切片（大文件场景）
 */
import SmartUpload from './SmartUpload.vue';
import type { UploadProps } from './internal/types';

defineOptions({ name: 'ChunkUpload' });

const props = defineProps<UploadProps>();
const emit = defineEmits<{
  'update:value': [v: string | string[]];
  change: [d: any];
  success: [d: any];
  error: [e: Error];
}>();
</script>

<template>
  <SmartUpload
    v-bind="props"
    force-mode="chunk"
    @update:value="(v: any) => emit('update:value', v)"
    @change="(d: any) => emit('change', d)"
    @success="(d: any) => emit('success', d)"
    @error="(e: any) => emit('error', e)"
  >
    <template v-if="$slots.default" #default="scope">
      <slot v-bind="scope" />
    </template>
    <template v-if="$slots.extra" #extra="scope">
      <slot name="extra" v-bind="scope" />
    </template>
  </SmartUpload>
</template>
```

- [ ] **Step 4：SmartUpload 增加 forceMode prop**

回到 SmartUpload.vue 的 `<script setup>` 顶部，扩展 props（添加 `forceMode`，仅内部使用，不在 spec 中暴露给业务）：

```ts
const props = withDefaults(
  defineProps<UploadProps & { forceMode?: 'auto' | 'direct' | 'chunk' }>(),
  {
    value: () => '' as any,
    type: 'file',
    maxConcurrent: 0,
    accept: '',
    disabled: false,
    forceMode: 'auto',
  },
);
```

修改 `pickHook(file)`：

```ts
function pickHook(file: File) {
  if (props.forceMode === 'direct') return 'direct';
  if (props.forceMode === 'chunk') return 'chunk';
  const threshold = cfg.get().chunkThresholdMB * 1024 * 1024;
  return file.size > threshold ? 'chunk' : 'direct';
}
```

- [ ] **Step 5：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/components/Upload/SmartUpload.vue \
        apps/web-antd/src/components/Upload/DirectUpload.vue \
        apps/web-antd/src/components/Upload/ChunkUpload.vue
git commit -m "feat(upload): 新增 SmartUpload / DirectUpload / ChunkUpload 三组件

DirectUpload 与 ChunkUpload 是 SmartUpload 加 forceMode prop 的薄壳，
保证三组件 props/emits/slots 完全一致，业务页只需改 tag 名即可切换。
SmartUpload 内部按文件大小（chunkThresholdMB）自动选 useDirectUpload
或 useChunkUpload。"
git push
```

---

## Task 18：新建 components/Upload/index.ts

**Files:**

- Create: `apps/web-antd/src/components/Upload/index.ts`

- [ ] **Step 1：创建文件**

```ts
export { default as ChunkUpload } from './ChunkUpload.vue';
export { default as DirectUpload } from './DirectUpload.vue';
export { default as SmartUpload } from './SmartUpload.vue';

export type {
  UploadDetail,
  UploadItem,
  UploadProps,
  UploadSlotScope,
  UploadType,
} from './internal/types';
```

- [ ] **Step 2：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/components/Upload/index.ts
git commit -m "feat(upload): 新增 components/Upload 公共导出

业务页可写：import { SmartUpload, DirectUpload, ChunkUpload } from '#/components/Upload'"
git push
```

---

## Task 19：手动验证 - 上传组件能跑

⚠️ 不写任何业务页前先验证组件本身可用。

- [ ] **Step 1：临时改 upload-stress 测试页面**

修改 `apps/web-antd/src/views/_core/upload-stress/index.vue` 的 script 顶部 + template：

把整个 `<script setup>` 替换为：

```ts
import { ref } from 'vue';

import { Card } from 'ant-design-vue';

import { ChunkUpload, DirectUpload, SmartUpload } from '#/components/Upload';

defineOptions({ name: 'UploadStress' });

const v1 = ref<string[]>([]);
const v2 = ref<string[]>([]);
const v3 = ref<string[]>([]);

function onChange(label: string, d: any) {
  console.log('[change]', label, d);
}
```

`<template>` 替换为：

```vue
<template>
  <div style="padding: 24px; max-width: 1200px; margin: 0 auto">
    <h1>新组件回归测试</h1>
    <div
      style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px"
    >
      <Card title="DirectUpload (强制直传)" size="small">
        <DirectUpload
          type="files"
          v-model:value="v1"
          @change="(d) => onChange('direct', d)"
        />
        <pre>{{ v1 }}</pre>
      </Card>
      <Card title="ChunkUpload (强制切片)" size="small">
        <ChunkUpload
          type="files"
          v-model:value="v2"
          @change="(d) => onChange('chunk', d)"
        />
        <pre>{{ v2 }}</pre>
      </Card>
      <Card title="SmartUpload (按 10MB 自动选)" size="small">
        <SmartUpload
          type="files"
          v-model:value="v3"
          @change="(d) => onChange('smart', d)"
        />
        <pre>{{ v3 }}</pre>
      </Card>
    </div>
  </div>
</template>
```

- [ ] **Step 2：浏览器验证**

确保 dev server + API 都在运行。访问 `http://localhost:6012/test/upload-stress`：

测试矩阵：

1. 三个组件各拖入一个 < 10MB 文件 → DirectUpload 走直传，ChunkUpload 走切片，SmartUpload 走直传，全部成功并显示在 `<pre>`
2. 三个组件各拖入一个 > 10MB 文件 → SmartUpload 走切片
3. 多文件排队：拖 3 个文件，观察 status 依次 queued → uploading → done
4. 取消按钮：上传中点取消，列表项消失
5. 重试：人工模拟失败（断网或后端 throw）→ 红框 + 重试按钮
6. v-model 显示相对路径

- [ ] **Step 3：记录验证结果**

如果任何步骤失败，回到对应 task 修复后再继续。

如全部通过，**不 commit 这次临时改的测试页面**（Task 27 会再做最终版）。把 upload-stress/index.vue 还原到 commit ce4813d3 的版本：

```bash
cd /Users/tianlong/projects/sb/sb-admin
git checkout ce4813d3 -- apps/web-antd/src/views/_core/upload-stress/index.vue
```

---

## Task 20：业务页迁移 - avatar-setting.vue

**Files:**

- Modify: `apps/web-antd/src/views/_core/profile/avatar-setting.vue`

- [ ] **Step 1：读取现状**

```bash
cat /Users/tianlong/projects/sb/sb-admin/apps/web-antd/src/views/_core/profile/avatar-setting.vue
```

记录现有逻辑：用 `<Upload :customRequest>` + `await uploadFileApi(file)` + `await changeAvatarApi(result.absfileName)`。

- [ ] **Step 2：替换为 DirectUpload**

把 `<script setup>` 中：

- 删除 `import { uploadFileApi } from '#/api/core/admin'`
- 改为 `import { DirectUpload } from '#/components/Upload'`
- 删除手写 customRequest handler；保留 `changeAvatarApi`

把 `<template>` 中现有 `<Upload>` 块换成：

```vue
<DirectUpload
  type="image"
  v-model:value="form.avatar"
  @success="onAvatarUploaded"
/>
```

`form.avatar` 现在存相对路径。新增：

```ts
async function onAvatarUploaded(detail: {
  absfileName: string;
  fileName: string;
}) {
  // changeAvatarApi 习惯用绝对 URL（保持后端兼容）
  await changeAvatarApi(detail.absfileName);
  message.success('头像更新成功');
}
```

- [ ] **Step 3：兼容旧绝对 URL**

如果初始 `form.avatar` 来自后端是绝对 URL（http://...），加一次性 strip：

```ts
const stripHost = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');
// 在加载用户信息后：
form.avatar = stripHost(userInfo.avatar || '');
```

- [ ] **Step 4：浏览器验证**

访问个人中心 → 上传头像 → 成功后看到新头像；刷新页面后头像仍在。

- [ ] **Step 5：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/views/_core/profile/avatar-setting.vue
git commit -m "refactor(upload): avatar-setting 切换到 DirectUpload 组件

删除手写 customRequest + uploadFileApi，改用 <DirectUpload type=\"image\">。
v-model 存相对路径，向 changeAvatarApi 提交时用 detail.absfileName。"
git push
```

---

## Task 21：业务页迁移 - SettingRender.vue（系统设置 3 种 DisplayType）

**Files:**

- Modify: `apps/web-antd/src/views/system-setting/SettingRender.vue`

- [ ] **Step 1：读取现状**

`SettingRender.vue` 内有 DisplayType 6（ImageUpload）/17（MultiImageUpload）/18（FileUpload）三个 case。每个 case 现在是手写 `<Upload :customRequest>` + `await uploadFileApi(file)`。

- [ ] **Step 2：替换三个 case 为 DirectUpload**

把 `import { uploadFileApi } from '#/api/core/admin'` 删除，加：

```ts
import { DirectUpload } from '#/components/Upload';
```

DisplayType 6 (ImageUpload):

```vue
<DirectUpload
  type="image"
  :value="modelValue"
  @update:value="$emit('update:modelValue', $event)"
/>
```

DisplayType 17 (MultiImageUpload):

```vue
<DirectUpload
  type="images"
  :value="modelValue"
  @update:value="$emit('update:modelValue', $event)"
/>
```

DisplayType 18 (FileUpload):

```vue
<DirectUpload
  type="files"
  :value="modelValue"
  @update:value="$emit('update:modelValue', $event)"
/>
```

注意：原 modelValue 可能是绝对 URL，新组件期望相对路径。SettingRender 是受控组件，调用方传什么就显示什么；推荐**在 List.vue / Form.vue 加载设置时把绝对 URL strip 为相对**（或者后续单独迁移设置项数据）。先保留兼容：

在 `<DirectUpload>` 上方加一个 computed：

```ts
const stripHost = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');
const valueComputed = computed({
  get() {
    const v = props.modelValue;
    if (Array.isArray(v)) return v.map(stripHost);
    return typeof v === 'string' ? stripHost(v) : v;
  },
  set(v) {
    emit('update:modelValue', v);
  },
});
```

DirectUpload 用 `v-model:value="valueComputed"`。

- [ ] **Step 3：浏览器验证**

访问系统设置页面，测试 ImageUpload/MultiImageUpload/FileUpload 三种类型字段：

- 点击编辑设置项
- 上传图/多图/文件
- 确认保存后值正确

- [ ] **Step 4：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/views/system-setting/SettingRender.vue
git commit -m "refactor(upload): SettingRender 三种上传 DisplayType 切换到 DirectUpload

DisplayType 6/17/18 全部改用 <DirectUpload>。stripHost 兼容老数据库
存的绝对 URL，v-model 内部走相对路径。"
git push
```

---

## Task 22：业务页迁移 - setup.vue（安装向导）

**Files:**

- Modify: `apps/web-antd/src/views/_core/setup/setup.vue`

- [ ] **Step 1：读取现状**

```bash
grep -n "uploadFileApi\|customRequest" /Users/tianlong/projects/sb/sb-admin/apps/web-antd/src/views/_core/setup/setup.vue
```

定位安装向导中的上传调用（通常是 logo / 产品图）。

- [ ] **Step 2：替换**

把现有 `<Upload>` 块换成 `<DirectUpload type="image">` 类似 Task 20 处理。删除 `import { uploadFileApi }` 与手写 customRequest。

- [ ] **Step 3：浏览器验证**

访问 `/setup`（如能访问），上传 logo / 产品图，确认上传成功后下一步流程正常。

- [ ] **Step 4：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/views/_core/setup/setup.vue
git commit -m "refactor(upload): 安装向导 setup.vue 切换到 DirectUpload"
git push
```

---

## Task 23：业务页迁移 - deploy/List.vue（API + 项目部署）

**Files:**

- Modify: `apps/web-antd/src/views/deploy/List.vue`

- [ ] **Step 1：读取现状**

`deploy/List.vue` 当前使用 `useSmartUpload({forceChunk: true})` + 手写 syncState/UploadState/setInterval 三件套（已修过 bug）。共两块：

- API 上传（顶部 Card）
- 项目部署（下方 Card，per-target）

- [ ] **Step 2：完全重写为 ChunkUpload**

删除以下代码：

- `import { formatSpeed, useSmartUpload } from '#/components/SmartUpload/useSmartUpload'`
- `interface UploadState`、`function createUploadState`、`function syncState`
- `apiUploader` / `apiState` / `apiTimer` / `clearApiTimer` / `handleUploadApi` / `handleCancelApi`
- `projectStates` / `projectUploaderMap` / `projectTimerMap` / `getProjectState` / `getProjectUploader` / `clearProjectTimer` / `handleUploadProject` / `handleCancelProject`

加新 import：

```ts
import { ChunkUpload } from '#/components/Upload';
```

新增简洁的处理函数（API 部署用）：

```ts
const apiUploadValue = ref<string>('');

async function onApiZipUploaded(detail: {
  fileName: string;
  absfileName: string;
  size: number;
}) {
  apiState.deploying = true;
  try {
    await postDeployApiByPath(detail.fileName, detail.name, detail.size);
    message.success('上传成功，程序即将重启');
    apiUploadValue.value = '';
    startRestartPolling();
  } catch (e: any) {
    message.error(e?.message || '部署失败');
  } finally {
    apiState.deploying = false;
  }
}
```

`apiState` 简化为 `{ deploying: boolean }`。

类似地处理项目部署：每个 target 一个 v-model（用 Record<string, string>），@success 调 postDeployProjectByPath。

模板：

```vue
<!-- API Card 内部 -->
<ChunkUpload
  type="file"
  v-model:value="apiUploadValue"
  accept=".zip"
  :disabled="apiState.deploying"
  @success="onApiZipUploaded"
/>

<!-- Project 循环内 -->
<ChunkUpload
  type="file"
  :value="projectValues[target.key] ?? ''"
  @update:value="(v: any) => (projectValues[target.key] = v)"
  accept=".zip"
  :disabled="projectStates[target.key]?.deploying"
  @success="(d: any) => onProjectZipUploaded(target.key, d, target.name)"
/>
```

- [ ] **Step 3：浏览器验证**

访问"部署"页面：

- 上传 API zip → 应该能上传 + 部署 + 触发重启 polling
- 多 target 同时上传项目 zip → 各自独立显示，互不干扰
- 取消按钮工作

- [ ] **Step 4：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/views/deploy/List.vue
git commit -m "refactor(upload): deploy/List 切换到 ChunkUpload 组件

删除全部 useSmartUpload + syncState + setInterval 样板（约 100 行），
改用 <ChunkUpload type=\"file\">。多 target per-target v-model 仍并发独立。
保留部署调用与重启 polling 业务逻辑不变。"
git push
```

---

## Task 24：业务页迁移 - upload-stress/index.vue（最终版）

**Files:**

- Modify: `apps/web-antd/src/views/_core/upload-stress/index.vue`

- [ ] **Step 1：完全重写为新组件演示**

```vue
<script lang="ts" setup>
import { ref } from 'vue';

import { Alert, Card } from 'ant-design-vue';

import { ChunkUpload, DirectUpload, SmartUpload } from '#/components/Upload';

defineOptions({ name: 'UploadStress' });

/** 单图（DirectUpload） */
const single = ref<string>('');
/** 多文件（ChunkUpload） */
const multi = ref<string[]>([]);
/** 智能（SmartUpload） */
const smart = ref<string[]>([]);

function logChange(label: string, d: any) {
  console.log(`[${label}] change`, d);
}
</script>

<template>
  <div style="max-width: 1200px; margin: 0 auto; padding: 24px">
    <h1 style="margin-bottom: 16px; font-size: 20px; font-weight: 600">
      上传组件回归测试
    </h1>
    <Alert
      type="info"
      show-icon
      message="并发独立性 + 取消 + 重试 + 排队验证"
      description="同时在 3 个组件触发上传，预期：每个组件独立显示进度；取消按钮只取消自己；重试可恢复失败项；多文件排队（同时仅 1 个 uploading）。"
      style="margin-bottom: 16px"
    />
    <div
      style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px"
    >
      <Card title="DirectUpload 单图" size="small">
        <DirectUpload
          type="image"
          v-model:value="single"
          @change="(d: any) => logChange('direct-img', d)"
        />
        <pre style="margin-top: 12px; font-size: 11px">
v-model: {{ single }}</pre
        >
      </Card>
      <Card title="ChunkUpload 多文件" size="small">
        <ChunkUpload
          type="files"
          v-model:value="multi"
          @change="(d: any) => logChange('chunk-files', d)"
        />
        <pre style="margin-top: 12px; font-size: 11px">
v-model: {{ multi }}</pre
        >
      </Card>
      <Card title="SmartUpload 自动" size="small">
        <SmartUpload
          type="files"
          v-model:value="smart"
          @change="(d: any) => logChange('smart-files', d)"
        />
        <pre style="margin-top: 12px; font-size: 11px">
v-model: {{ smart }}</pre
        >
      </Card>
    </div>
    <div style="margin-top: 24px; font-size: 12px; color: rgba(0, 0, 0, 0.45)">
      路由：<code>/test/upload-stress</code>（dev 调试用）。 后端 dev
      限速：1500ms/片（appsettings.Development.json
      UploadConfig.DebugThrottleMs）。
    </div>
  </div>
</template>
```

- [ ] **Step 2：浏览器验证（同 Task 19 矩阵）**

- [ ] **Step 3：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add apps/web-antd/src/views/_core/upload-stress/index.vue
git commit -m "refactor(test): upload-stress 改用新组件作为回归测试页

三组件并列演示 DirectUpload/ChunkUpload/SmartUpload，覆盖单图、多文件、
自动选 3 个典型场景。原 BUG 模式复刻已通过 git history 存档。"
git push
```

---

## Task 25：grep 检查无残留引用

- [ ] **Step 1：搜索旧 import / API**

```bash
cd /Users/tianlong/projects/sb/sb-admin
grep -rn "useSmartUpload\|uploadFileApi\|api/core/chunkUpload\|api/core/admin.*upload\|components/SmartUpload" apps/web-antd/src --include="*.vue" --include="*.ts" 2>/dev/null
```

预期：除了 `components/SmartUpload/` 旧目录自己以外，其它结果应该为空。如果有业务页残留，回到对应 task 补迁移。

- [ ] **Step 2：搜索旧 endpoint 路径**

```bash
grep -rn "/admin/Auth/Upload\|/admin/ChunkUpload\|/Auth/Upload\|/ChunkUpload" apps/web-antd/src --include="*.vue" --include="*.ts" 2>/dev/null
```

预期：仅 `api/core/chunkUpload.ts`（旧文件，下个 task 删）和 `api/core/admin.ts`（旧 uploadFileApi，下个 task 删）有结果。

- [ ] **Step 3：记录结果**

把检查结果保存（不 commit），用于 Task 26-27 的删除决策。

---

## Task 26：删除前端旧文件

**Files:**

- Delete: `apps/web-antd/src/components/SmartUpload/` 整目录
- Delete: `apps/web-antd/src/api/core/chunkUpload.ts`
- Modify: `apps/web-antd/src/api/core/admin.ts`（删 `uploadFileApi`）

- [ ] **Step 1：删除目录与文件**

```bash
cd /Users/tianlong/projects/sb/sb-admin
rm -r apps/web-antd/src/components/SmartUpload
rm apps/web-antd/src/api/core/chunkUpload.ts
```

- [ ] **Step 2：admin.ts 删 uploadFileApi**

定位 `apps/web-antd/src/api/core/admin.ts` 第 64 行附近的 `export async function uploadFileApi(file: File) { ... }` 整段函数（5 行左右），删除。

- [ ] **Step 3：再次 grep 确认无残留**

```bash
cd /Users/tianlong/projects/sb/sb-admin
grep -rn "useSmartUpload\|uploadFileApi\|components/SmartUpload\|api/core/chunkUpload" apps/web-antd/src --include="*.vue" --include="*.ts" 2>/dev/null
```

预期：空输出。

- [ ] **Step 4：跑构建确认**

```bash
cd /Users/tianlong/projects/sb/sb-admin/apps/web-antd
pnpm vite build --mode development 2>&1 | tail -20
```

预期：构建成功，无未引用错误。

- [ ] **Step 5：commit**

```bash
cd /Users/tianlong/projects/sb/sb-admin
git add -u apps/web-antd/src/components/SmartUpload \
        apps/web-antd/src/api/core/chunkUpload.ts \
        apps/web-antd/src/api/core/admin.ts
git commit -m "chore(upload): 删除旧 SmartUpload / chunkUpload / uploadFileApi

components/SmartUpload/（整目录）、api/core/chunkUpload.ts、admin.ts 中
uploadFileApi 函数全部删除。所有业务页已迁移到 components/Upload/* 三组件。"
git push
```

---

## Task 27：执行 Task 8（后端删旧 Controller）

回到 Task 8 步骤执行（前端调用方已全部迁移完毕）。

---

## Task 28：完整端到端验证

- [ ] **Step 1：跑前端构建**

```bash
cd /Users/tianlong/projects/sb/sb-admin/apps/web-antd
pnpm vite build --mode production 2>&1 | tail -20
```

预期：构建成功。

- [ ] **Step 2：跑前端测试**

```bash
cd /Users/tianlong/projects/sb/sb-admin/apps/web-antd
pnpm vitest run 2>&1 | tail -20
```

预期：useUploadQueue 4 个测试 PASS，其他既有测试不被破坏。

- [ ] **Step 3：后端构建**

```bash
cd /Users/tianlong/projects/sb/sb-api
dotnet build 2>&1 | tail -10
```

预期：`Build succeeded`。

- [ ] **Step 4：浏览器矩阵测试**

逐一验证：

- 个人头像（avatar-setting）：上传/查看/重新上传
- 系统设置（SettingRender）：3 种类型字段都能上传
- 安装向导（setup）：如能访问，logo 上传
- 部署（deploy/List）：API zip 上传 + 项目 zip 上传 + 多 target 并发
- `/test/upload-stress`：3 组件 × 6 type × 各种边缘情况

任何失败回到对应 task 修复。

- [ ] **Step 5：通过则不需要 commit（无代码变更）**

整体重构完毕。

---

## Self-Review Notes（写完后我自己检查的事项）

1. **Spec 覆盖性**：所有 Section 1-14 的需求点都在 task 中体现 ✓
2. **任务依赖顺序**：Task 8（删 ChunkUploadController）依赖前端全部迁移完，因此移到 Task 27 ✓
3. **TDD**：useUploadQueue 走 TDD（Task 14-15）；UI 组件靠 Task 19 + 28 手动验证
4. **commit 频率**：每个 task 一个 commit，符合"frequent commits"原则
5. **代码完整性**：每段代码块都是可直接复制的实际内容，无 TODO/TBD
6. **类型一致性**：UploadProps / UploadDetail / UploadItem / UploadSlotScope 在 types.ts 一处定义，其它文件 import
