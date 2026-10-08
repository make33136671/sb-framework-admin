/**
 * DramaFlow 业务接口（契约 §5.1）
 *
 * 约定：
 * - 后端 controller 全部 [FromForm]（SB0002），request.ts 拦截器已自动转
 *   form-urlencoded，无需手动设置 Content-Type；
 * - GET 用 { params }，POST 直接传对象；
 * - 时间统一 UTC（带 Z），展示用 TimeTag 组件；
 * - 不手写配对 toast（拦截器已处理），静默请求传 { silent: true }。
 */
import { api } from '#/api/request';

// ─────────────────────────── 类型（与后端视图字段对齐） ───────────────────────────

export interface DramaItem {
  id: number;
  code: string;
  name: string;
  genre?: string;
  synopsis?: string;
  status: string;
  episodeTargetCount: number;
  /**
   * 第 2 层提示词（剧目整体风格，可空）。
   *
   * 归属为**剧目**而非剧本版本：`Script` 有 version + is_current（一副多版本），
   * 风格挂剧本会让每次洗稿都要重设，且出现"同剧不同版本画风不一致"。
   */
  styleNegativePrompt?: null | string;
  stylePrompt?: null | string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export interface DramaDetail {
  drama: DramaItem;
  scriptVersion: number;
  scriptStatus: string;
  episodeCount: number;
  shotCount: number;
  requirementCount: number;
  clipDone: number;
  productDone: number;
}

export interface ScriptEpisodeScene {
  text: string;
  duration: number;
}

export interface ScriptEpisode {
  no: number;
  title: string;
  scenes: ScriptEpisodeScene[];
  /** 本集对应的原始稿片段（查看详情里对照用） */
  sourceExcerpt?: string;
  sourceStart?: number;
  sourceEnd?: number;
  /** matched=按关键词命中定位；split=按集均分的估算 */
  sourceConfidence?: string;
}

export interface ScriptDetail {
  id: number;
  dramaId: number;
  version: number;
  sourceText: string;
  rewrittenText?: string;
  episodes: ScriptEpisode[];
  episodeCount: number;
  model?: string;
  /** 本版洗稿使用的细化选项快照（JSON 字符串） */
  rewriteOptions?: null | string;
  llmCallId?: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetRequirementItem {
  id: number;
  dramaId: number;
  key: string;
  /** 版本号（append-only：同一 key 可多版） */
  version: number;
  /** 是否为该 key 的当前生效版本 */
  isCurrent: boolean;
  /** 来源：storyboard（分镜推导）/ extract（LLM 提取）/ manual（人工） */
  source?: string;
  kind: string;
  description?: string;
  spec?: string;
  /** 已保存的第 ③ 层正向提示词（弹窗重开时回填） */
  subjectPrompt?: null | string;
  /** 已保存的第 ③ 层反向提示词（弹窗重开时回填） */
  subjectNegative?: null | string;
  status: string;
  approvedAssetId?: number;
  /** 该 key 的版本总数（用于显示"共 N 版"） */
  versionCount?: number;
  candidateCount: number;
  approvedCount: number;
  pendingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetCandidateItem {
  id: number;
  taskId: number;
  variantNo: number;
  /** 种子（字符串形态：用户实测可用的 seed 超出 int32，且 JS number 超 2^53 会丢精度）*/
  seed?: null | string;
  prompt: string;
  filePath?: string;
  width?: number;
  height?: number;
  status: string;
  rejectReasonId?: number;
  rejectNote?: string;
  createdAt: string;
}

export interface ReasonItem {
  id: number;
  scope: string;
  code: string;
  name: string;
  fixHint?: string;
  sortNo?: number;
}

export interface ShotItem {
  id: number;
  dramaId: number;
  scriptVersion: number;
  episodeNo: number;
  shotNo: number;
  description?: string;
  dialogue?: string;
  durationSec: number;
  composition?: string;
  lighting?: string;
  mood?: string;
  characterRefs?: string;
  sceneRef?: string;
  assetIds?: string;
  status: string;
  clip?: null | {
    durationSec?: number;
    error?: string;
    id: number;
    status: string;
    videoPath?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: number;
  type: string;
  dramaId: number;
  /** 剧目名（Task/List 批量带出，看板显示「哪个剧目在跑」） */
  dramaName?: string;
  /** 剧目编码 */
  dramaCode?: string;
  /** 本次任务使用的剧本版本（0 = 尚无剧本） */
  scriptVersion?: number;
  /** 「具体在跑什么」：素材 key / 第几集第几镜等（后端已翻成人话） */
  target?: string;
  /** 指定服务 id（null/undefined = 未指定，执行时走该能力的默认服务） */
  providerId?: null | number;
  /** 服务名（展示「用哪个服务跑」） */
  providerName?: null | string;
  /**
   * 指定的模型**当前为何不可用**（null = 可用，或本就未指定模型）。
   *
   * 实测场景：任务被指定了一个不具备所需能力的模型后，会一直停在 queued
   * （领取 SQL 的 `provider_id IS NULL OR provider_id=@p_svc` 把它排除），
   * 界面上只显示"排队中"看不出原因。非空时模型列标红并给出原因。
   */
  providerUnavailableReason?: null | string;
  /** 该任务类型需要的能力位掩码（说明「为什么有些服务是灰的」） */
  requiredCapability?: number;
  /**
   * 上云路由（成本感知调度 §8.7 / T14.11）：
   * **`cloud` = 该任务有成本感知上云决策；`null` = 无上云决策记录**（前端不展示徽标）。
   * 后端目前只发 `cloud`，没有 `local` / `cloud_manual` 取值 —— 不要猜。
   */
  route?: null | string;
  /** 上云原因码（目前只有 `cloud_cost_benefit`） */
  routeReason?: null | string;
  /**
   * 上云原因的中文说明（后端拼好，**优先于前端本地映射表**展示），
   * 如「优惠时段内性价比达标，自动上云执行」。
   */
  routeReasonText?: null | string;
  /** 该次上云的预计花费（元）；仅 route=cloud 时非空 */
  costYuan?: null | number;
  /** 该次上云是否处于优惠时段（谷时）；null = 未知 */
  offPeak?: boolean | null;
  /** 两档优先级（1=高）。排序第一关键字，与领取 SQL 一致。 */
  priority: number;
  /**
   * 队列内显式顺序（越小越先执行）。
   *
   * 面板必须用它排 —— 只按 id 排会与领取顺序（priority DESC, sort_no ASC, id ASC）
   * 不一致，用户读到的先后就是反的（这正是「看不懂队列」的成因之一）。
   */
  sortNo?: number;
  refEntityType?: string;
  refEntityId?: number;
  status: string;
  version: number;
  currentVariant: number;
  progress: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  heartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** 任务 LLM token 汇总（按 llm_call_log.task_id 归集） */
export interface TaskTokenSummary {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 含估算值（网关未回 usage 时按字符数估算）→ 展示必须标注 */
  estimated: boolean;
}

/** 任务交互日志一行（后端由 job / task_version / 任务状态**派生**，不新增表） */
export interface TaskLogItem {
  /** 时间（项目时区墙上时间，TimeTag 原样展示） */
  at: string;
  /** 事件类别：task 任务状态 · prompt 提示词 · job 生图作业 · error 失败 */
  kind: 'error' | 'job' | 'prompt' | 'task' | string;
  /** 级别：info / warn / error / ok */
  level: 'error' | 'info' | 'ok' | 'warn' | string;
  /** 一句话说明 */
  title: string;
  /** 细节（可折叠展示：ComfyUI prompt_id / 错误正文 / 提示词全文） */
  detail?: null | string;
  /** 关联作业 id（可点跳产物） */
  jobId?: null | number;
  /** 关联变体序号（0 起） */
  variantNo?: null | number;
  /** 耗时毫秒（仅 job 类：提交→完成） */
  durationMs?: null | number;
}

/** 产物预览的一格：filePath 为空 = **还没产出** → 前端画等待占位符 */
export interface TaskPreviewSlot {
  variantNo: number;
  /** 该格提示词（为空表示尚未生成） */
  prompt?: null | string;
  /** 媒体绝对路径（media_root 下）；为空 = 等待占位符 */
  filePath?: null | string;
  width?: null | number;
  height?: null | number;
  seed?: null | string;
  /** 候选状态：pending / approved / rejected / failed */
  status?: null | string;
  /** 该格在等什么（人话：排队第 N / 正在生成 / 已失败…） */
  waitReason?: null | string;
  /** 该格绑定的作业状态 */
  jobStatus?: null | string;
  jobId?: null | number;
}

/** 本次任务实际调用的工作流（含**兜底来源**标注，不变量 9） */
export interface TaskWorkflowInfo {
  id: number;
  key: string;
  name?: null | string;
  kind?: null | string;
  /** job 实际使用 / model_binding / provider_default / system_setting / unknown */
  source: string;
  sourceText?: null | string;
  /** 是否走了兜底（非模型显式绑定） */
  isFallback: boolean;
}

/** 产物预览面板（按**预期产物数**铺格，缺的格子是等待占位符） */
export interface TaskPreview {
  expectedCount: number;
  doneCount: number;
  /** image / video / none（文本类任务无视觉产物） */
  mediaKind: string;
  /** 任务级等待说明（面板顶部那句话） */
  waitReason?: null | string;
  /** 是否仍在等待（决定是否画动态等待图标） */
  waiting: boolean;
  /** 当前提示词 */
  currentPrompt?: null | string;
  /** 当前调用的工作流 */
  workflow?: null | TaskWorkflowInfo;
  slots: TaskPreviewSlot[];
}

export interface TaskDetail extends TaskItem {
  /** 剧目名（Task/Get 带出） */
  dramaName?: string;
  /** 该任务的 LLM token 汇总 */
  tokens?: null | TaskTokenSummary;
  versions: {
    failReason?: string;
    id: number;
    promptSnapshot?: string;
    seed?: null | string;
    status: string;
    submittedAt: string;
    versionNo: number;
  }[];
  jobs: {
    comfyuiPromptId?: string;
    completedAt?: string;
    error?: string;
    id: number;
    seed?: null | string;
    status: string;
    submittedAt: string;
    variantNo: number;
    workflowKey: string;
  }[];
  /** 生图交互日志（派生时间线；按时间正序） */
  logs?: TaskLogItem[];
  /** 产物预览面板 */
  preview?: null | TaskPreview;
}

/** tokens 桶（今日 / 近 7 天共用形状） */
export interface TokenBucket {
  prompt: number;
  completion: number;
  calls: number;
  failedCalls: number;
}

export interface DashboardMetrics {
  throughput: { today: number; trend: number[]; week: number };
  rejectRate: { image: number; video: number; windowDays: number };
  reviewBacklog: {
    byKind: { drama: number; image: number; video: number };
    oldestHours: number;
    pending: number;
  };
  gpu: { inFlight: number; queue: number; window: string; windowOpen: boolean };
  eta: { estHours: number; remainingTasks: number };
  /** 第 6 指标（设计 §B）：AI tokens 消耗 */
  tokens: {
    byPurpose: {
      avgLatencyMs: number;
      calls: number;
      purpose: string;
      tokens: number;
    }[];
    /** 估算调用数 / 实测调用数（数据可信性，P0 配套） */
    estimated: number;
    measured: number;
    today: TokenBucket;
    trend: {
      calls: number;
      completion: number;
      date: string;
      prompt: number;
    }[];
    week: TokenBucket;
  };
}

/** D 区：待我决策（轻量预览，设计 §D） */
export interface PendingDecisions {
  images: {
    candidateCount: number;
    dramaId: number;
    dramaName?: string;
    kind?: string;
    previews: { candidateId: number; filePath?: string }[];
    requirementId: number;
    requirementKey?: string;
    version: number;
  }[];
  videos: {
    clipId: number;
    dramaId: number;
    dramaName?: string;
    error?: string;
    shotId: number;
    status: string;
    videoPath?: string;
  }[];
  products: {
    coverPath?: string;
    dramaId: number;
    dramaName?: string;
    durationSec?: number;
    episodeId: number;
    episodeNo: number;
    videoPath?: string;
  }[];
  scripts: {
    dramaId: number;
    dramaName?: string;
    scriptId: number;
    status: string;
    version: number;
  }[];
  counts: {
    images: number;
    products: number;
    scripts: number;
    total: number;
    videos: number;
  };
}

/** E 区：AI 消耗（设计 §E） */
export interface TokenUsage {
  range: { days: number; from: string; to: string };
  today: TokenBucket;
  totals: TokenBucket;
  trend: {
    calls: number;
    completion: number;
    date: string;
    failedCalls: number;
    prompt: number;
  }[];
  byModel: {
    avgLatencyMs: number;
    calls: number;
    completion: number;
    failedCalls: number;
    model: string;
    prompt: number;
    provider?: string;
  }[];
  byPurpose: {
    avgLatencyMs: number;
    calls: number;
    completion: number;
    failedCalls: number;
    prompt: number;
    purpose: string;
  }[];
  recentErrors: {
    createdAt: string;
    error?: string;
    model?: string;
    provider?: string;
    purpose: string;
  }[];
  /** 数据可信性：估算 vs 实测调用数、涉及的 provider */
  quality: {
    estimatedCalls: number;
    measuredCalls: number;
    providers: string[];
  };
}

export interface NightReport {
  window: { end: string; start: string };
  submitted: number;
  completed: number;
  failed: number;
  rejected: number;
  taskCount: number;
  durationMinutes: {
    count: number;
    max: number;
    median: number;
    min: number;
    p90: number;
  };
  topRejectReasons: {
    code?: string;
    count: number;
    name?: string;
    reasonId: number;
  }[];
}

export interface ProductEpisodeItem {
  id: number;
  episodeNo: number;
  version: number;
  videoPath?: string;
  coverPath?: string;
  durationSec?: number;
  sizeBytes?: number;
  status: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  historyVersions: number[];
}

export interface WorkflowTemplateItem {
  id: number;
  key: string;
  name: string;
  template: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LlmTemplateItem {
  id: number;
  key: string;
  purpose?: string;
  template: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewQueueItem {
  target: string;
  id: number;
  dramaId: number;
  dramaName?: string;
  // 图
  taskId?: number;
  requirementId?: number;
  requirementKey?: string;
  kind?: string;
  variantNo?: number;
  filePath?: string;
  prompt?: string;
  seed?: null | string;
  version?: number;
  // 剧
  episodeNo?: number;
  videoPath?: string;
  coverPath?: string;
  durationSec?: number;
  sizeBytes?: number;
  // 片段
  shotId?: number;
  status?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ─────────────────────────── Drama ───────────────────────────

export async function dramaList(params: {
  archived?: boolean;
  keyword?: string;
  page?: number;
  pageSize?: number;
  status?: string;
}) {
  return api.get<{ items: DramaItem[]; total: number }>('/Drama/List', {
    params,
  });
}

export async function dramaGet(id: number) {
  return api.get<DramaDetail>('/Drama/Get', { params: { id } });
}

/**
 * 创建剧目。支持**建剧同时上传剧本**（横向结构 P5-5 / D1）：
 *   - `scriptFile` → 解析 .docx 后落 v1（文件优先）
 *   - `scriptText` → 直接落 v1
 * 两者都不给 = 只建剧（之后可在剧本 Tab 上传）。
 * 剧本导入失败**不回滚建剧**（返回 message 里会说明），用户可稍后重试。
 *
 * ⚠️ 带文件时必须手工构造 FormData：request.ts 的拦截器只在 `config.data instanceof FormData`
 * 时删除 Content-Type（让浏览器自动加 multipart boundary）。直接把 File 塞进普通对象
 * 会被序列化成 form-urlencoded，文件变成一个空字符串字段 —— 静默失败。
 * 参数名 `scriptFile` 必须与后端 `IFormFile? scriptFile` 完全一致。
 */
export async function dramaAdd(data: {
  code?: string;
  episodeTargetCount?: number;
  genre?: string;
  name: string;
  scriptFile?: File;
  scriptText?: string;
  synopsis?: string;
}) {
  if (data.scriptFile) {
    const formData = new FormData();
    if (data.code) formData.append('code', data.code);
    formData.append('name', data.name);
    if (data.genre) formData.append('genre', data.genre);
    if (data.synopsis) formData.append('synopsis', data.synopsis);
    formData.append(
      'episodeTargetCount',
      String(data.episodeTargetCount ?? 10),
    );
    if (data.scriptText) formData.append('scriptText', data.scriptText);
    formData.append('scriptFile', data.scriptFile);
    return api.post<{ id: number; scriptId?: null | number }>(
      '/Drama/Add',
      formData,
    );
  }
  return api.post<{ id: number; scriptId?: null | number }>('/Drama/Add', {
    code: data.code,
    name: data.name,
    genre: data.genre,
    synopsis: data.synopsis,
    episodeTargetCount: data.episodeTargetCount ?? 10,
    scriptText: data.scriptText,
  });
}

export async function dramaUpdate(data: {
  episodeTargetCount?: number;
  genre?: string;
  id: number;
  name: string;
  /**
   * 第 2 层提示词（剧目整体风格）。
   *
   * ⚠️ `undefined` = **不改动**该字段；`''` = 显式清空。
   * 两者语义不同 —— 若把"没带该字段"当成清空，改个剧目名就会把用户
   * 已配好的风格提示词**静默清掉**。
   */
  styleNegativePrompt?: string;
  stylePrompt?: string;
  synopsis?: string;
}) {
  return api.post('/Drama/Update', data);
}

export async function dramaSetStatus(id: number, status: string) {
  return api.post('/Drama/SetStatus', { id, status });
}

export async function dramaArchive(id: number) {
  return api.post('/Drama/Archive', { id });
}

export async function dramaRestore(id: number) {
  return api.post('/Drama/Restore', { id });
}

// ─────────────────────────── Script ───────────────────────────

export async function scriptGet(dramaId: number, version?: number) {
  return api.get<ScriptDetail>('/Script/Get', {
    params: version ? { dramaId, version } : { dramaId },
  });
}

export async function scriptSave(dramaId: number, sourceText: string) {
  return api.post<{ id: number; version: number }>('/Script/Save', {
    dramaId,
    sourceText,
  });
}

/** Word 剧本解析结果（POST /Script/ParseWord，只解析不写库） */
export interface WordParseResult {
  fileName: string;
  text: string;
  charCount: number;
  lineCount: number;
  headings: { level: number; text: string }[];
  tableCount: number;
  metadata: { author: string; created: string; title: string };
}

/**
 * 上传 .docx 剧本 → 纯文本（供预览校对后再 Save）。
 * 上传的剧本通常为 Word 格式；因 source_text 不可变，故解析与入库分离，
 * 先让用户确认内容无误，再写入。
 */
export async function scriptParseWord(file: File): Promise<WordParseResult> {
  const formData = new FormData();
  formData.append('file', file);
  return api.post<WordParseResult>('/Script/ParseWord', formData, {
    quiet: true,
  });
}

/** 上传 .docx 并直接存为原始稿 v1（仅当尚无任何版本） */
export async function scriptImportWord(dramaId: number, file: File) {
  const formData = new FormData();
  formData.append('dramaId', String(dramaId));
  formData.append('file', file);
  return api.post<{ charCount: number; id: number; version: number }>(
    '/Script/ImportWord',
    formData,
  );
}

export async function scriptRewrite(
  dramaId: number,
  providerId?: null | number,
  /** 洗稿细化选项（JSON 字符串，键名与后端 RewriteOptions 一致） */
  rewriteOptions?: null | string,
) {
  return api.post<{ options: number; taskId: number }>('/Script/Rewrite', {
    dramaId,
    providerId,
    rewriteOptions,
  });
}

export async function scriptVersionList(dramaId: number) {
  return api.get<
    {
      createdAt: string;
      episodeCount: number;
      hasRewritten: boolean;
      id: number;
      model?: string;
      status: string;
      version: number;
    }[]
  >('/Script/VersionList', { params: { dramaId } });
}

export async function scriptCompare(
  dramaId: number,
  versionA: number,
  versionB: number,
) {
  return api.get<{
    a: { episodeCount: number; sourceLength: number; version: number };
    b: { episodeCount: number; sourceLength: number; version: number };
    episodes: {
      aScenes: number;
      bScenes: number;
      changed: boolean;
      episodeNo: number;
    }[];
    sourceIdentical: boolean;
  }>('/Script/Compare', { params: { dramaId, versionA, versionB } });
}

// ─────────────────────────── Shot ───────────────────────────

export async function shotList(params: {
  dramaId: number;
  episodeNo?: number;
  page?: number;
  pageSize?: number;
  scriptVersion?: number;
  status?: string;
}) {
  return api.get<{ items: ShotItem[]; total: number }>('/Shot/List', {
    params,
  });
}

export async function shotGet(id: number) {
  return api.get<{
    assets: {
      approvedAssetId?: number;
      id: number;
      key: string;
      kind: string;
      status: string;
    }[];
    shot: ShotItem;
    tasks: TaskItem[];
  }>('/Shot/Get', { params: { id } });
}

export async function shotSave(data: Record<string, any>) {
  return api.post('/Shot/Save', data);
}

export async function shotStaleReplay(id: number, providerId?: null | number) {
  return api.post<{ taskId: number; version: number }>('/Shot/StaleReplay', {
    id,
    providerId,
  });
}

// ─────────────────────────── Asset ───────────────────────────

export async function assetRequirementList(params: {
  /** 默认只看当前生效版本；传 false 可列出全部历史版本 */
  currentOnly?: boolean;
  dramaId: number;
  kind?: string;
  page?: number;
  pageSize?: number;
  status?: string;
}) {
  return api.get<{ items: AssetRequirementItem[]; total: number }>(
    '/Asset/RequirementList',
    { params },
  );
}

/** 素材提取历史版本（append-only，可回选） */
export async function assetVersionList(dramaId: number, key: string) {
  return api.get<AssetRequirementItem[]>('/Asset/VersionList', {
    params: { dramaId, key },
  });
}

/** 回选某个历史版本为当前生效版本 */
export async function assetSetCurrentVersion(id: number) {
  return api.post<{ id: number; version: number }>('/Asset/SetCurrentVersion', {
    id,
  });
}

/** 软删除某个素材版本 */
export async function assetVersionDelete(id: number) {
  return api.post('/Asset/VersionDelete', { id });
}

/**
 * 触发「素材提取」：用 LLM 从剧本正文提取 角色/道具/场景。
 * 每次调用新增一版（不覆盖），返回 taskId 供跟踪进度。
 */
export async function assetExtractStart(
  dramaId: number,
  providerId?: null | number,
) {
  return api.post<{ taskId: number }>('/Asset/ExtractStart', {
    dramaId,
    providerId,
  });
}

export async function assetRequirementGet(id: number) {
  return api.get<{
    candidates: AssetCandidateItem[];
    reasons: ReasonItem[];
    requirement: AssetRequirementItem;
    tasks: TaskItem[];
  }>('/Asset/RequirementGet', { params: { id } });
}

export async function assetRequirementSave(data: {
  description?: string;
  dramaId: number;
  id?: number;
  kind: string;
  name: string;
  spec?: string;
}) {
  return api.post<{ id: number }>('/Asset/RequirementSave', data);
}

/**
 * **只保存角色描述**（不动 key / kind / name / spec）。
 *
 * 为什么单独一个接口、不复用 `assetRequirementSave`：
 * 那条接口会按 `name` **重算 key**，而 key 是角色视图 / 候选 / 任务的关联锚点。
 * 弹窗里只想改"描述"这一个字段，走那条路既要前端从 key 反推 name（脆），
 * 又有"name 传错 → key 被改掉 → 历史候选全部对不上"的风险。
 * 这里语义收窄到"改描述"，从根上排除改坏 key。
 */
export async function assetRequirementSaveDescription(data: {
  description?: null | string;
  id: number;
}) {
  return api.post<{ id: number }>('/Asset/RequirementSaveDescription', data);
}

/**
 * **保存该视图的提示词**（正向 + 反向，第 ③ 层）。
 *
 * 为什么需要它（2026-10-07 用户报障）：
 * > 「生成角色提示词…不会保存 重新打开这个页面 提示词又变回去了」
 *
 * 生成结果原先只活在前端表单里，关掉弹窗即丢；重开时又从**视图 spec**
 * （固定模板）重新填一遍，于是用户看到"白生成了"。现在落库，重开即可回填。
 *
 * 两个字段都是**整值覆盖**：传空串 = 清空该层（不是"不修改"），
 * 否则用户把内容删光后就再也清不掉了。
 */
export async function assetRequirementSavePrompts(data: {
  id: number;
  subjectNegative?: null | string;
  subjectPrompt?: null | string;
}) {
  return api.post<{ id: number }>('/Asset/RequirementSavePrompts', data);
}

/**
 * **专用提示词生成通道**（供角色视图弹窗的「一键生成提示词」）。
 *
 * · 正向：真调 ComfyUI 上的 PE-T2I（9.4B）把角色描述改写成英文画面描述；
 * · 反向：**规则推导**（不调模型）—— 实测 PE-T2I 的 system_prompt 强制
 *   "只描述画面里有什么"，做不到产出负向词。
 *
 * ⚠️ 长耗时（实测 50s+，冷启更久）：调用方**必须**传 `signal` 以便用户取消，
 *    并自行识别取消（`CanceledError`）与真实失败的区别。
 */
export async function assetGeneratePrompts(
  data: {
    /** 未保存的最新描述；不传则用库里已保存的 description */
    brief?: null | string;
    requirementId: number;
    /**
     * 视图的构图约束（视图 spec）。
     *
     * ⚠️ 必须传：7 视图要求**纯灰底、无场景元素**。PE-T2I 的 system_prompt 写着
     * "没提到的它自己决定"，不把这条约束喂进去，模型会自造背景
     * （实测生成过 "warm off-white studio background / window / furniture"）——
     * 带背景的立绘无法用于后续合成，等于废图。
     */
    viewPrompt?: null | string;
    /** 视图专有反向约束（如 "full body, wide shot"），附加到规则反向词末尾 */
    viewNegative?: null | string;
  },
  options?: { signal?: AbortSignal },
) {
  return api.post<{
    negativePrompt: string;
    positiveError: null | string;
    positivePrompt: null | string;
    whRatio: null | string;
  }>('/Asset/GeneratePrompts', data, {
    signal: options?.signal,
    // ⚠️ 必须显式给足超时：RequestClient 默认只有 **10 秒**，
    //    而 PE-T2I（9.4B / 17.9 GB 权重）实测要 **52–56 秒**。
    //    不给就会复现那个极迷惑的现象 —— ComfyUI 控制台显示
    //    "Prompt executed in 55.99 seconds"（真跑通了），前端却报超时。
    //    这里给 10 分钟：与后端 pe_t2i_timeout_sec 默认值（600s）对齐，
    //    留出冷启加载权重的余量；用户随时可用「等待中，点击取消」中断，
    //    所以给长一点没有副作用。
    timeout: 10 * 60 * 1000,
    // 静默：本接口耗时很长，拦截器的全局 loading/toast 会与按钮内 loading 重复，
    // 且取消时不该弹错误。错误由调用方自己决定怎么呈现。
    silent: true,
  });
}

/**
 * 为已有角色补齐「视图/机位」需求（存量数据迁移）。
 *
 * 背景：视图拆分在**素材提取**时生效，所以已提取过的角色不会自动获得视图结构。
 * 不补齐的话，现网角色依旧是"只有特写、没有全身" —— 而下游全景镜头需要全身参考。
 * 只建档、不触发出图（由用户决定给哪些角色生成，避免一次性占满 GPU）。
 * 幂等：重复调用只补缺，不产生重复行。
 */
export async function assetBackfillCharacterViews(dramaId: number) {
  return api.post<{ characters: number; created: number; skipped: number }>(
    '/Asset/BackfillCharacterViews',
    { dramaId },
  );
}

export async function assetCandidateList(requirementId: number) {
  return api.get<AssetCandidateItem[]>('/Asset/CandidateList', {
    params: { requirementId },
  });
}

export async function assetGenerate(
  requirementId: number,
  providerId?: null | number,
) {
  return api.post<{ taskId: number; version: number }>('/Asset/Generate', {
    requirementId,
    providerId,
  });
}

export async function assetApprove(candidateId: number) {
  return api.post<{ staled: number }>('/Asset/Approve', { candidateId });
}

/**
 * **解除定稿**（把已选中的图改回未定稿状态）。
 *
 * 用户原话：
 * > 「我说的清空选择 是把选择图 改为 未定稿状态 清除他的定稿」
 *
 * 后端会一起回滚：需求状态 → pending、被定稿候选 → pending、引用方标记 stale。
 * 幂等：本来未定稿时返回 changed=false，**不报错**（批量里混着未定稿是常态）。
 */
export async function assetUnapprove(requirementId: number) {
  return api.post<{ changed: boolean; requirementId: number; staled: number }>(
    '/Asset/Unapprove',
    { requirementId },
  );
}

// ── 角色 × 视图矩阵（格子选图）─────────────────────────────────────
//
// 用户诉求：「7 个标准视图做到一个页面上，这个标准视图是空的，点击就从现有角色的图像里选择」。
//
// 语义：格子里选一张图 = **定稿该视图**（该图成为这个视图的最终选择）。
// 与 `assetApprove` 的区别：`assetApprove` 只能"从本需求的候选里挑一张"，
// 而矩阵页要的是**跨视图选图**（该角色任意已有的图都能填进任意格子），
// 所以后端另开了 `SetViewImage`。

/** 矩阵里的一个视图格子。 */
export interface CharacterViewCell {
  /** 该视图的已定稿候选 id；null = 格子还是空的 */
  approvedAssetId?: null | number;
  /** 视图中文名（如「全身正面」）—— 来自后端，前端不写死 */
  label: string;
  /** 对应的素材需求 id；null = 该视图需求还没建档（需先「补齐角色视图」） */
  requirementId?: null | number;
  status: string;
  /** 视图后缀（face_front / full_body_front / …） */
  suffix: string;
}

/** 选图池里的一张候选图。 */
export interface CharacterImageOption {
  createdAt?: string;
  filePath: string;
  height?: null | number;
  id: number;
  requirementId: number;
  requirementKey: string;
  status: string;
  variantNo: number;
  /** 该图来自哪个视图的已定稿图；null = 未分类（旧的无后缀需求） */
  viewLabel: string;
  viewSuffix?: null | string;
  width?: null | number;
}

export interface CharacterMatrixRow {
  /** 该角色的全部已有候选图（跨视图、含旧数据）—— 选图池 */
  candidates: CharacterImageOption[];
  /**
   * 角色外观描述（7 个视图共享同一条）。
   *
   * 「一键 7 图」必须把它作为**提示词生成的输入** —— 它回答"画谁"，
   * 而 `spec` 只回答"怎么拍"（45° 侧脸 + 纯灰底）。
   * 少了它，出图模型只能画出随机路人（实测：伊丽莎白画出来是个男的）。
   */
  description?: null | string;
  name: string;
  /** 固定 7 个格子，顺序由后端（CharacterViews.Standard）决定 */
  views: CharacterViewCell[];
}

export interface CharacterMatrix {
  characters: CharacterMatrixRow[];
  /**
   * 列定义（顺序 + 中文名 + 该视图的提示词与建议尺寸），与 views 一一对应。
   *
   * `spec` / `negativeSpec` / `width` / `height` 由后端从 `CharacterViews`
   * （唯一事实源）产出，供「去生成」预填下发页 —— 前端**不再写一份视图表**，
   * 否则两边各写一套必然漂移。
   */
  viewColumns: {
    height?: number;
    label: string;
    negativeSpec?: string;
    spec?: string;
    suffix: string;
    width?: number;
  }[];
}

/**
 * 角色 × 视图矩阵数据（一次拉全，供整页选图）。
 *
 * 刻意一次返回：逐格子请求会打出 N×7 个请求。
 */
export async function assetCharacterMatrix(dramaId: number) {
  return api.get<CharacterMatrix>('/Asset/CharacterCandidates', {
    params: { dramaId },
  });
}

/**
 * 把一张已有候选图指定为某个视图的定稿图（矩阵格子选图）。
 *
 * 只能选**同一角色**的图（后端按角色名校验并拒绝跨角色 —— 否则会把别人的脸
 * 安静地填进这个角色的视图）。若该视图原本已有定稿图，改选会把引用它的
 * 分镜/片段标记为 stale（返回 staled 数量）。
 */
export async function assetSetViewImage(
  requirementId: number,
  candidateId: number,
) {
  return api.post<{ approvedAssetId: number; staled: number }>(
    '/Asset/SetViewImage',
    { candidateId, requirementId },
  );
}

/**
 * 丢弃候选（后端 Action 仍叫 Reject，语义 = 移出候选池）。
 *
 * `reasonId` **非必填**（用户明确要求：「丢弃 但是 原因并不是必填项」）——
 * 快速丢掉明显废图时不该被强制先选原因。
 *
 * 但原因**有价值**：它经 fix_hint 进入下一版 prompt_rewrite 的修复上下文
 *（告诉 LLM「上次为什么被否」），所以界面上仍应提供选择器并说明这一点，
 * 只是不拦提交。
 */
export async function assetReject(
  candidateId: number,
  reasonId?: null | number,
  note?: string,
) {
  return api.post('/Asset/Reject', { candidateId, reasonId, note });
}

export async function assetToLibrary(candidateId: number, tags?: string) {
  return api.post<{ id: number }>('/Asset/ToLibrary', { candidateId, tags });
}

export async function assetLibraryList(params: {
  keyword?: string;
  kind?: string;
  page?: number;
  pageSize?: number;
}) {
  return api.get<{
    items: {
      createdAt: string;
      filePath: string;
      id: number;
      key: string;
      kind: string;
      sourceCandidateId: number;
      tags?: string;
    }[];
    total: number;
  }>('/Asset/LibraryList', { params });
}

// ─────────────────────────── Task ───────────────────────────

/**
 * 任务列表（**服务端分页 + 服务端筛选**）。
 *
 * `keyword` 必须下推给后端：分页后前端只有当前一页，
 * 在本地做关键词过滤会变成"只搜当前页"（搜第 3 页的任务得到空结果，且无提示）。
 *
 * `status` 除单个状态外，还接受两个**聚合**取值（由后端展开）：
 *   · `running` → preparing / generating / collecting
 *   · `done`    → approved / done / rejected
 * 聚合也必须在后端做，否则同样会"把当前页过滤空但分页器还显示有下一页"。
 */
export async function taskList(params: {
  dramaId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
  status?: string;
  type?: string;
}) {
  return api.get<{ items: TaskItem[]; total: number }>('/Task/List', {
    params,
  });
}

export async function taskGet(id: number) {
  return api.get<TaskDetail>('/Task/Get', { params: { id } });
}

// ── 统一 AI 生成下发入口 ────────────────────────────────────────────
//
// 用户要求：「统一入口……所有的参数都有默认，调用方传过来的时候会覆盖这些参数，
// 没覆盖的就随默认走；就算没有调用方，我自己新建生成，点开什么也不改也可以生成」。
//
// 因此**没有任何必填字段**（除归属需要由页面保证 —— 后端要求至少能定位到剧目）。
// 调用方（如角色视图的「去生成」）只需传自己特有的那层，前两层提示词由后端补齐。

export interface TaskSubmitParams {
  /** 生成张数（1–8）；不传用全局 candidate_count */
  candidateCount?: null | number;
  dramaId: number;
  /** 出图高；不传用默认 */
  height?: null | number;
  /** 命名模板（预留；实际命名由后端按需求 key 生成） */
  namePattern?: null | string;
  /** **反向提示词**；传了则整层覆盖（不再叠加三层） */
  negativePrompt?: null | string;
  /** 出图线路 */
  providerId?: null | number;
  /** **正向提示词**；传了则整层覆盖，跳过三层拼装 */
  prompt?: null | string;
  refEntityId?: null | number;
  /** 归属类型；角色视图传 `asset_requirement` 即可把产物挂回该视图 */
  refEntityType?: null | string;
  /** 种子；传了就用它（可复现同一张图），不传则确定性推导 */
  seed?: null | string;
  /** 第 3 层：角色/视图特有的正向约束（由调用方传，如视图 spec） */
  subjectNegative?: null | string;
  /** 第 3 层：角色/视图特有的反向约束 */
  subjectPrompt?: null | string;
  type?: null | string;
  /** 出图宽；不传用默认 */
  width?: null | number;
  workflowId?: null | number;
}

/** 提交结果：回显实际使用的提示词与层构成（让用户看见"哪些是自动补的"）。 */
export interface TaskSubmitResult {
  layers: string;
  negativePrompt: string;
  positivePrompt: string;
  taskId: number;
  usedFallbackNegative: boolean;
  usedFallbackPositive: boolean;
  version: number;
}

/**
 * 统一生成下发。
 *
 * ⚠️ 与「跳转预填」的区别：这个函数**才会真正建任务**。
 * 角色视图的「去生成」只是带参数跳转到页面，用户点了提交才走到这里
 * （用户明确要求：中途关掉页面 = 什么都没发生）。
 */
export async function taskSubmit(params: TaskSubmitParams) {
  return api.post<TaskSubmitResult>('/Task/Submit', params);
}

/**
 * 批量下发角色视图（用户 2026-10-06：
 * 「可以批量选择角色 执行批量一键7视图」「点击一键7视图 实际上是加入任务列队」）。
 *
 * ## 为什么必须是**一次调用**
 *
 * 用户实测报障：
 * > 「点击 一键生成7视图 是不是 关掉页面 任务就结束了 如果生成了2张
 * >   在关掉页面后 剩下的 5张图 不会在生成了」
 *
 * **确实如此。** 原来 7 次下发跑在浏览器循环里，关页面/切标签/睡眠都会让循环终止，
 * 后面的视图任务**根本没被创建**（不是"创建了没执行"），且不报错。
 *
 * 改成一次调用后：请求返回时所有任务已入库，页面关不关都不影响。
 *
 * 每个需求建 2 个任务：`prompt_gen`（文本组）+ `t2i`（生图组），
 * 由后端按分区分段分配 sort_no，天然形成"先提示词、后出图"的顺序。
 */
export async function taskBatchSubmitViews(params: {
  autoFinalize?: boolean;
  candidateCount?: number;
  providerId?: number;
  requirementIds: number[];
}) {
  return api.post<{
    created: {
      /** null = 该视图已有提示词，**跳过**了阶段① 提示词任务（直接出图） */
      promptGenTaskId: null | number;
      requirementId: number;
      t2iTaskId: number;
    }[];
    /** 已有提示词、被复用（未重做提示词）的视图 */
    promptReused: { key: string; requirementId: number }[];
    skipped: { requirementId: number; why: string }[];
  }>('/Task/BatchSubmitViews', {
    autoFinalize: params.autoFinalize,
    candidateCount: params.candidateCount,
    providerId: params.providerId,
    requirementIds: params.requirementIds.join(','),
  });
}

/**
 * **批量补充提示词**（用户 2026-10-07：「一键生7图边上 加入一个 一键补充提示词」）。
 *
 * 为每个视图下发一条 `image_prompt_gen` 任务，由编排器调 PE-T2I 生成
 * 正/反向提示词并**落回该需求**（下次打开弹窗即可见）。
 *
 * 为什么走任务队列而不是同步调：
 * 用户明确要求「希望在 AI 执行任务列表里 显示这些 AI 任务」——
 * 同步调用（`assetGeneratePrompts`）在任务列表里完全不可见，
 * 用户无法判断跑到哪、失败没有。走队列后每条都是正规任务，
 * 可排队、可取消、可重试、可在执行窗口看日志。
 */
export async function taskBatchSubmitPromptGen(params: {
  requirementIds: number[];
}) {
  return api.post<{
    created: { key: string; requirementId: number; taskId: number }[];
    skipped: { requirementId: number; why: string }[];
  }>('/Task/BatchSubmitPromptGen', {
    requirementIds: params.requirementIds.join(','),
  });
}

/**
 * **批量生成提示词**（素材页多选 → 「一键生成提示词」）。
 *
 * 只下发 `image_prompt_gen`（PE-T2I），**不出图**；产物落回需求的
 * subjectPrompt/subjectNegative，并进 AI 任务列表（可查看进度/取消/重试）。
 */
export async function assetBatchGeneratePrompts(
  requirementIds: number[],
  force = false,
) {
  return api.post<{
    created: { key: string; requirementId: number; taskId: number }[];
    replaced: { requirementId: number; what: string }[];
    skipped: { requirementId: number; why: string }[];
    force: boolean;
  }>('/Asset/BatchGeneratePrompts', {
    requirementIds: requirementIds.join(','),
    force,
  });
}

/**
 * **批量生成图像**（素材页多选 → 「一键生成图像」）。
 *
 * `autoFinalize` 勾选后由**后端**在出图完成时自动定稿第一张 ——
 * 不是前端等待（前端等待会被关页面打断）。
 *
 * `force` 勾选后**清空现有图片**（含定稿）再生成新的 ——
 * 用户原话：「图片就是 清空掉现有选择的 生成新的」。
 */
export async function assetBatchGenerate(params: {
  autoFinalize?: boolean;
  candidateCount?: number;
  force?: boolean;
  providerId?: number;
  requirementIds: number[];
}) {
  return api.post<{
    created: { key: string; requirementId: number; taskId: number }[];
    replaced: { requirementId: number; removedCandidates: number }[];
    skipped: { requirementId: number; why: string }[];
    force: boolean;
  }>('/Asset/BatchGenerate', {
    requirementIds: params.requirementIds.join(','),
    providerId: params.providerId,
    autoFinalize: params.autoFinalize,
    candidateCount: params.candidateCount,
    force: params.force,
  });
}

/**
 * **保存角色信息**（角色信息弹窗：改名 / 改描述）。
 *
 * ⚠️ 一个角色在库里是 **7 行需求**（7 个视图各一行），描述共享。
 * 该接口按角色名定位全部 7 行一起更新 —— 后端做了这件事，
 * 前端**不要**自己循环调 `assetRequirementSaveDescription`（那样只改一个视图，
 * 现象是"改了描述只有某个视图生效"且不报错）。
 */
export async function assetSaveCharacter(data: {
  description?: null | string;
  dramaId: number;
  name: string;
  newName?: null | string;
}) {
  return api.post<{ name: string; updated: number }>(
    '/Asset/SaveCharacter',
    data,
  );
}

export async function taskRetry(id: number) {
  return api.post<{ taskId: number; version: number }>('/Task/Retry', { id });
}

export async function taskCancel(id: number) {
  return api.post('/Task/Cancel', { id });
}

/** 重新生成：任意状态都可再跑一版（开新版本、保留历史），用于"结果不满意，重做" */
/**
 * 提交式重新生成（用户诉求：「任务提交形式的 —— 改完关键词和生成几张图这些参数，
 * 提交任务再去生成」，并要「分辨率、高宽」等更细参数）。
 *
 * 所有参数都是**可选**的：不传即完全等价于旧的「重新生成」
 * （回落全局 candidate_count 与默认 1024×1024）。
 *
 * 后端会 **钳制** 参数（张数 1–8、宽高 256–2048）并 **对齐到 64 的倍数**，
 * 返回的 `applied` 是**真实生效值** —— 界面必须回显它，而不是用户填的原值，
 * 否则「设了 700 实际 704」会让用户以为设置没生效。
 */
export async function taskRegenerate(
  id: number,
  note?: string,
  params?: {
    candidateCount?: null | number;
    height?: null | number;
    negativePrompt?: null | string;
    priority?: number;
    promptOverride?: null | string;
    providerId?: null | number;
    seed?: null | string;
    width?: null | number;
  },
) {
  return api.post<{
    /** 后端钳制/对齐后的**真实生效值** */
    applied?: {
      candidateCount?: null | number;
      hasPromptOverride?: boolean;
      height?: null | number;
      width?: null | number;
    };
    taskId: number;
    version: number;
  }>('/Task/Regenerate', {
    id,
    note,
    ...params,
  });
}

/** 删除子任务（保留记录可追溯；在飞任务需先取消） */
export async function taskDelete(id: number, reason?: string) {
  return api.post('/Task/Delete', { id, reason });
}

/** 手动修改子任务常用字段（备注/进度） */
export async function taskUpdate(data: {
  error?: string;
  id: number;
  progress?: number;
}) {
  return api.post('/Task/Update', data);
}

/**
 * 手动接管：给**排队中**的任务指定执行模型（providerId 传 null = 改回"自动"）。
 *
 * 用户诉求：「AI任务里只有自动排队，不能手动指定任务模型跑，这部分我希望可以手动接管」。
 * 只有 status=queued 的任务可改；已开跑/已结束的会被后端拒绝（改了也不会影响本次执行，
 * 只会让界面显示"已改为X"——那种静默不一致比报错更难查）。
 */
export async function taskAssignProvider(
  id: number,
  providerId: null | number,
) {
  return api.post('/Task/AssignProvider', { id, providerId });
}

/**
 * 立即执行：把**排队中**的任务插到队首（只提优先级，不改任务归属）。
 *
 * 用户诉求：「AI任务列表里 排队中的 不能设置立即执行」。
 * ⚠️ 插队只解决"排队位置"，解决不了"根本没有可用服务"
 * （节点离线 / 云端开关关闭 / 模型不匹配）—— 故后端会回 `blockedReason`，
 * 前端必须透传，否则"点了还是没跑"会变成无从排查的谜题。
 */
export async function taskRunNow(id: number) {
  return api.post<{
    blockedReason?: null | string;
    priority: number;
    source: string;
    taskId: number;
  }>('/Task/RunNow', { id });
}

/**
 * 队列内上移 / 下移（用户 2026-10-06：
 * 「可以让用户直接操作真实的任务队列 比如改先后顺序」）。
 *
 * ⚠️ **只在同一组内交换**（文本组 / 生图组）——跨组会破坏"文本组整体在前"的
 * 分段结构，进而造成额外的模型切换。到组边界时后端会返回明确原因（不静默不动）。
 */
export async function taskMove(id: number, direction: 'down' | 'up') {
  return api.post<{ id: number; sortNo: number; swappedWith: number }>(
    '/Task/Move',
    { direction, id },
  );
}

/** 任务是否属于生图组（前端分组展示用，与后端 TaskSort.IsGpuGroup 一致）。 */
export const GPU_GROUP_TYPES = new Set(['i2v', 't2i']);

/** 任务是否属于文本组（提示词/文本类，先于生图执行）。 */
export const TEXT_GROUP_TYPES = new Set([
  'analyze',
  'asset_extract',
  'episode_split',
  // 图片提示词增强（2026-10-07）：产物是文本，归文本组（与后端
  // TaskSort.IsGpuGroup / SchedClass.Tasks[Text] 一致）。
  'image_prompt_gen',
  'partial_rewrite',
  'prompt_gen',
  'rewrite',
  'storyboard',
]);

/**
 * 批量操作（用户 2026-10-05：「AI 任务 增加一个批量操作功能 暂停 删除 之类的」）。
 *
 * 后端**尽力而为 + 逐条回报**（不做整体回滚）：批量对象往往混着已完成/状态不匹配的条目，
 * 整体回滚会导致"选 50 条想清掉、有 3 条已完成"就一条都处理不了。
 * 故返回值里带 `skipped`，前端要如实把"跳过了哪几条、为什么"告诉用户。
 */
export async function taskBatch(
  ids: number[],
  action: 'cancel' | 'delete' | 'retry',
) {
  return api.post<{
    ok: number;
    skipped: { id: number; why: string }[];
  }>('/Task/Batch', { ids: ids.join(','), action });
}

/**
 * 一键暂停 / 恢复（全局）。
 *
 * 用户原话：
 * > 「顶部也加入个 一键暂停 就是AI就是个机器 不管他连接那条线路
 * >   执行哪个任务 暂停了就全部都停下了」
 *
 * 语义：暂停 = 编排器**不再领取任何任务** + **中断在飞任务**；
 * 排队中的任务保持 queued，恢复后自动继续（不是"取消"，是"暂停"）。
 */
export async function taskPauseAll(reason?: string) {
  return api.post<{ interrupted: number; queued: number }>('/Task/PauseAll', {
    reason,
  });
}

export async function taskResumeAll() {
  return api.post<{ queued: number }>('/Task/ResumeAll', {});
}

/** 全局暂停状态（顶部按钮据此显示"暂停"还是"恢复"）。 */
export async function taskPauseStatus() {
  return api.get<{ inFlight: number; paused: boolean; queued: number }>(
    '/Task/PauseStatus',
  );
}

/**
 * 生图尺寸的**当前生效值**（后端三级优先解析后的结果）。
 *
 * 由后端解析而不是前端自己算：来源是「视图覆盖 → 通用默认 → 代码兜底」三级回落，
 * 前端再实现一遍必然与后端漂移 —— 那种漂移的表现是"设置页改了、下发页没变"，
 * 且**不会报错**。
 */
export async function taskSizes() {
  return api.get<{
    defaultHeight: number;
    defaultSource: string;
    defaultWidth: number;
    views: {
      height: number;
      label: string;
      source: string;
      suffix: string;
      width: number;
    }[];
  }>('/Task/Sizes');
}

export async function taskStats(dramaId?: number) {
  return api.get<{
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    inFlightI2v: number;
    inFlightT2i: number;
    queued: number;
    recentFailures: TaskItem[];
    /** 未终态任务的 token 汇总：taskId → 汇总（看板显示在跑任务烧了多少 token） */
    tokensByTask: Record<number, TaskTokenSummary>;
    total: number;
  }>('/Task/Stats', { params: dramaId ? { dramaId } : {} });
}

// ─────────────────────────── AI 全局日志 ───────────────────────────

/** 一次 LLM 调用记录（`llm_call_log`，append-only；失败的调用同样有一行）。 */
export interface AiCallLogItem {
  channel?: string;
  completionTokens: number;
  createdAt: string;
  dramaId?: null | number;
  dramaName?: null | string;
  error?: null | string;
  id: number;
  latencyMs: number;
  model?: null | string;
  promptTokens: number;
  provider?: null | string;
  providerId?: null | number;
  providerName?: null | string;
  purpose: string;
  /** local / cloud —— 这次调用走的是本地还是云端算力 */
  route?: null | string;
  taskId?: null | number;
  /** true = 网关没返回 usage，token 是按字符数估算的（界面必须如实标注） */
  tokensEstimated: boolean;
}

/** 一条系统运行事件（`audit_log`：调度决策/告警/任务生命周期）。 */
export interface AiSystemEventItem {
  action: string;
  actor?: null | string;
  after?: null | string;
  before?: null | string;
  createdAt: string;
  entityId: number;
  entityType: string;
  id: number;
  /** 同一事件连续重复了多少次（折叠前）；1 = 无重复 */
  repeatCount: number;
}

export interface AiCallLogQuery {
  dramaId?: number;
  keyword?: string;
  onlyError?: boolean;
  page?: number;
  pageSize?: number;
  purpose?: string;
  taskId?: number;
}

/**
 * 逐次 LLM 调用日志（全局，支持按任务/剧目/用途/关键字/成败筛选）。
 *
 * 用户诉求：「ai任务页面 加一个全局ai日志」——用于回答
 * 「这次调用发了什么、花了多少 token、报了什么错」。
 */
export async function aiLogCalls(params: AiCallLogQuery = {}) {
  return api.get<{ items: AiCallLogItem[]; total: number }>('/AiLog/Calls', {
    params,
  });
}

/** 调用统计（口径与列表筛选**一致**，避免"列表 3 条、指标卡 200 条"）。 */
export async function aiLogCallStats(params: AiCallLogQuery = {}) {
  return api.get<{
    avgLatencyMs: number;
    completionTokens: number;
    errors: number;
    estimated: number;
    promptTokens: number;
    total: number;
  }>('/AiLog/CallStats', { params });
}

/** 调用日志的筛选器可选值（从已有数据取 distinct，不写死枚举）。 */
export async function aiLogCallFilters() {
  return api.get<{ models: string[]; providers: string[]; purposes: string[] }>(
    '/AiLog/CallFilters',
  );
}

/**
 * 系统运行事件（调度决策/告警）——回答「为什么任务没被执行」。
 *
 * `collapse=true`（默认）会把**连续重复**的同一条事件折叠成一条并记次数：
 * 实测同一模型离线一天几百条，原样列出会把真正有用的信息淹掉。
 */
export async function aiLogEvents(
  params: {
    action?: string;
    collapse?: boolean;
    entityId?: number;
    entityType?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
    taskId?: number;
  } = {},
) {
  return api.get<{ items: AiSystemEventItem[]; total: number }>(
    '/AiLog/Events',
    { params },
  );
}

/** 系统事件的筛选器可选值（动作类型）。 */
export async function aiLogEventFilters() {
  return api.get<{ actions: string[] }>('/AiLog/EventFilters');
}

// ─────────────────────────── Review ───────────────────────────

export async function reviewQueue(params: {
  dramaId?: number;
  page?: number;
  pageSize?: number;
  target?: string;
}) {
  return api.get<{ items: ReviewQueueItem[]; total: number }>('/Review/Queue', {
    params,
  });
}

export async function reviewApprove(target: string, id: number) {
  return api.post('/Review/Approve', { target, id });
}

export async function reviewReject(
  target: string,
  id: number,
  reasonId?: number,
  note?: string,
) {
  return api.post('/Review/Reject', { target, id, reasonId, note });
}

/** 原子批处理：decisions 必须是 JSON 字符串（后端 [FromForm] string 接收） */
export async function reviewBatch(
  target: string,
  decisions: {
    decision: string;
    id: number;
    note?: string;
    reasonId?: number;
  }[],
) {
  return api.post<{ count: number }>('/Review/Batch', {
    target,
    decisions: JSON.stringify(decisions),
  });
}

// ─────────────────────────── Dashboard ───────────────────────────

export async function dashboardMetrics(dramaId?: number) {
  return api.get<DashboardMetrics>('/Dashboard/Metrics', {
    params: dramaId ? { dramaId } : {},
  });
}

export async function dashboardNightReport(dramaId?: number) {
  return api.get<NightReport>('/Dashboard/NightReport', {
    params: dramaId ? { dramaId } : {},
  });
}

/** D 区：待我决策预览（图片候选缩略 + 视频/成片/剧本待办） */
export async function dashboardPendingDecisions(params: {
  dramaId?: number;
  limit?: number;
  previewsPerGroup?: number;
}) {
  return api.get<PendingDecisions>('/Dashboard/PendingDecisions', { params });
}

/** E 区：AI 消耗聚合（趋势 / 按模型 / 按用途 / 最近错误） */
export async function dashboardTokenUsage(params: {
  days?: number;
  model?: string;
  purpose?: string;
}) {
  return api.get<TokenUsage>('/Dashboard/TokenUsage', { params });
}

// ─────────────────────────── Template ───────────────────────────

/** 工作流静态体检结果（保存前展示「能不能被系统驱动」）。 */
export interface WorkflowAnalysis {
  errors: string[];
  format: 'api' | 'invalid' | 'ui';
  formatHint?: null | string;
  kind?: null | string;
  /** 工作流依赖的模型文件（checkpoint/vae/clip …） */
  models?: Record<string, string>;
  missing: string[];
  nodeCount: number;
  outputs: string[];
  present: string[];
  usable: boolean;
  warnings: string[];
}

export interface WorkflowTemplateRow {
  analysis: WorkflowAnalysis;
  boundModelCount: number;
  createdAt: string;
  /** 第 1 层提示词（工作流默认正向，可空）—— 提交时会自动拼在提示词最前 */
  defaultNegativePrompt?: null | string;
  defaultPrompt?: null | string;
  description?: null | string;
  id: number;
  isActive: boolean;
  key: string;
  kind?: null | string;
  name: string;
  template: string;
  updatedAt: string;
}

/** 连通性测试结果（真的跑了一次生成）。 */
export interface WorkflowTestResult {
  /** 产物内联预览（base64 data URL） */
  dataUrl?: null | string;
  detail?: null | string;
  elapsedMs: number;
  error?: null | string;
  fileBytes?: number;
  fileName?: null | string;
  fileUrl?: null | string;
  mimeType?: null | string;
  promptId?: null | string;
  providerName?: null | string;
  success: boolean;
}

export async function templateWorkflowList() {
  return api.get<WorkflowTemplateRow[]>('/Template/WorkflowList');
}

export async function templateWorkflowSave(data: {
  /**
   * 第 1 层提示词（工作流默认，可空）。
   * `undefined` = 不改动；`''` = 显式清空（不区分的后果：老调用方保存模板时
   * 会把用户已配的默认提示词**静默清掉**）。
   */
  defaultNegativePrompt?: string;
  defaultPrompt?: string;
  description?: string;
  /** 硬错误时需显式 force 才放行 */
  force?: boolean;
  id?: number;
  isActive?: boolean;
  key: string;
  name: string;
  template: string;
}) {
  return api.post<{
    id: number;
    kind?: string;
    warnings?: string[];
  }>('/Template/WorkflowSave', data);
}

/** 静态分析（不落库）：编辑器里边写边体检。 */
export async function templateWorkflowAnalyze(template: string) {
  return api.post<WorkflowAnalysis>('/Template/WorkflowAnalyze', { template });
}

/** 连通性测试：真的提交一次生成并取回产物。 */
export async function templateWorkflowTest(data: {
  height?: number;
  kind?: string;
  negativePrompt?: string;
  prompt: string;
  providerId?: number;
  seed?: null | string;
  template: string;
  /** 等待上限（秒）。视频工作流（LTX 22B 等）需要远超默认的 180s。 */
  timeoutSec?: number;
  width?: number;
}) {
  return api.post<WorkflowTestResult>('/Template/WorkflowTest', data);
}

export async function templateWorkflowDelete(id: number) {
  return api.post<null>('/Template/WorkflowDelete', { id });
}

// ── 「从 ComfyUI 导入」──────────────────────────────────────────
// 用户在 ComfyUI 网页调好工作流后 Ctrl+S 存在 ComfyUI 自己的 /userdata/workflows/，
// 那是 UI 格式（含 nodes/links），不能直接提交给 /prompt。这两个接口把列表读出来、
// 并在服务端转成 API 格式草稿返回（**不落库**）—— 用户再决定插占位符后保存。

/** 占位符建议（**只提示、不自动改**）：告诉用户哪个节点适合换成哪个占位符。 */
export interface WorkflowPlaceholderSuggestion {
  classType: string;
  confidence: 'high' | 'low' | 'medium';
  currentValue: string;
  field: string;
  nodeId: string;
  placeholder: string;
  reason: string;
}

/** ComfyUI 网页里已保存的工作流（文件名列表）。 */
export interface WorkflowImportCandidate {
  baseUrl?: string;
  files: string[];
  providerId?: null | number;
  providerName?: string;
}

export interface WorkflowImportResult {
  analysis: WorkflowAnalysis;
  apiJson: string;
  convertErrors: string[];
  convertWarnings: string[];
  fileName: string;
  nodeCount: number;
  suggestions: WorkflowPlaceholderSuggestion[];
}

/** 列出 ComfyUI 网页里保存的工作流。 */
export async function templateWorkflowImportList(providerId?: number) {
  return api.get<WorkflowImportCandidate>('/Template/WorkflowImportList', {
    params: { providerId },
  });
}

/** 拉取并转换一个 ComfyUI 网页工作流（返回草稿，不落库）。 */
export async function templateWorkflowImport(
  fileName: string,
  providerId?: number,
) {
  return api.post<WorkflowImportResult>('/Template/WorkflowImport', {
    fileName,
    providerId,
  });
}

export async function templateLlmList() {
  return api.get<LlmTemplateItem[]>('/Template/LlmList');
}

export async function templateLlmSave(data: {
  id?: number;
  isActive?: boolean;
  key: string;
  purpose?: string;
  template: string;
}) {
  return api.post<{ id: number }>('/Template/LlmSave', data);
}

export async function templateReasonList(scope?: string) {
  return api.get<ReasonItem[]>('/Template/ReasonList', {
    params: scope ? { scope } : {},
  });
}

export async function templateLlmCallLogs(params: {
  page?: number;
  pageSize?: number;
  purpose?: string;
}) {
  return api.get<{
    items: {
      completionTokens: number;
      createdAt: string;
      error?: string;
      id: number;
      latencyMs: number;
      model?: string;
      promptTokens: number;
      provider: string;
      purpose: string;
      requestHash: string;
    }[];
    total: number;
  }>('/Template/LlmCallLogs', { params });
}

// ─────────────────────────── Product ───────────────────────────

export async function productEpisodeList(dramaId: number) {
  return api.get<{
    clipDone: number;
    dramaId: number;
    dramaName: string;
    episodes: ProductEpisodeItem[];
    episodeTargetCount: number;
    scriptVersion: number;
  }>('/Product/EpisodeList', { params: { dramaId } });
}

export async function productRender(dramaId: number) {
  return api.post<{ clipDone: number; taskId: number; version: number }>(
    '/Product/Render',
    { dramaId },
  );
}

export async function productPublish(id: number) {
  return api.post('/Product/Publish', { id });
}

export async function productUnpublish(id: number) {
  return api.post('/Product/Unpublish', { id });
}

// ─────────────────────── 横向（Stage Row，横向结构 P5）───────────────────────
//
// 后端 GET /admin/Stage/Rows 返回五横向聚合：产物 / 版本 / 子项 / prompt 留档 /
// 前置门（gateOpen）/ 接续目标（nextRunnable）。
// 判定逻辑全在后端纯函数 StageRowCore（可离线验证），前端只做展示，不重算状态。

/** 横向状态（与后端 StageStatus 一一对应） */
export type StageStatus =
  | 'done'
  | 'failed'
  | 'pending'
  | 'running'
  | 'skipped'
  | 'stale';

/** 横向 key（破坏性变更：改名会让前端失配） */
export type StageKey =
  | 'analyze'
  | 'episodes'
  | 'extract'
  | 'produce'
  | 'rewrite';

/** 一次尝试轮（append-only 快照）—— promptSnapshot 即「提交给系统的关键词」 */
export interface StageAttempt {
  versionNo: number;
  status: string;
  seed?: null | string;
  failReason?: null | string;
  submittedAt: string;
  /** 提交给系统的关键词全记录（用户明确要求） */
  promptSnapshot?: null | string;
}

/** 某一横向的一次执行（任务 + 其尝试轮） */
export interface StageVersion {
  taskId: number;
  type: string;
  version: number;
  status: string;
  progress: number;
  error?: null | string;
  startedAt?: null | string;
  finishedAt?: null | string;
  providerId?: null | number;
  attempts: StageAttempt[];
}

/** 抽取横向的子项（素材需求：角色/道具/场景） */
export interface StageRequirementItem {
  id: number;
  kind: string;
  key: string;
  description?: null | string;
  status: string;
  approvedAssetId?: null | number;
  version: number;
}

/** 分集横向的子项（一集，可单独开始分镜） */
export interface StageEpisodeItem {
  id: number;
  episodeNo: number;
  title?: null | string;
  majorVersion: number;
  minorVersion: number;
  displayVersion: string;
  origin: string;
  shotCount: number;
}

/** 成片横向的镜级子项 */
export interface StageShotItem {
  id: number;
  shotNo: number;
  description?: null | string;
  dialogue?: null | string;
  durationSec: number;
  status: string;
  /** 用了哪些素材（用户诉求） */
  characterRefs?: null | string;
  sceneRef?: null | string;
  assetIds?: null | string;
  /** 产出了什么（片段） */
  clip?: null | {
    durationSec?: null | number;
    error?: null | string;
    id: number;
    scriptVersion: number;
    status: string;
    videoPath?: null | string;
  };
}

/** 成片横向的子项（集 → 镜） */
export interface StageEpisodeProduceItem {
  episodeNo: number;
  title?: null | string;
  product?: null | {
    coverPath?: null | string;
    durationSec?: null | number;
    id: number;
    status: string;
    version: number;
    videoPath?: null | string;
  };
  shots: StageShotItem[];
}

export interface StageRow {
  key: StageKey;
  name: string;
  status: StageStatus;
  /** 是否可选横向（仅洗稿为 true） */
  optional: boolean;
  /** 前置门是否满足（前端据此决定「开始/重跑」是否可点） */
  gateOpen: boolean;
  artifact: {
    clips?: number;
    count?: number;
    exists?: boolean;
    kind: string;
    products?: number;
    shots?: number;
    summary: string;
  };
  versions: StageVersion[];
  items: unknown[];
}

export interface StageRowsResult {
  dramaId: number;
  scriptVersion: number;
  /** 下一个应自动执行的横向（null = 全部完成或前置不满足） */
  nextRunnable: null | StageKey;
  rows: StageRow[];
}

/** 五横向聚合（横向结构 P1/P5） */
export async function stageRows(dramaId: number) {
  return api.get<StageRowsResult>('/Stage/Rows', { params: { dramaId } });
}

// ─────────────────────── 横向① 分析 / 横向④ 分集 / 分镜 ───────────────────────

/** 触发结构分析（横向①：只读结构，不改写正文） */
export async function scriptAnalyze(
  dramaId: number,
  providerId?: null | number,
) {
  return api.post<{ scriptId: number; taskId: number }>('/Script/Analyze', {
    dramaId,
    providerId,
  });
}

/** 查询剧本结构产物（含版本列表） */
export async function scriptStructure(dramaId: number, version?: number) {
  return api.get<{
    structure: {
      characterCount: number;
      createdAt: string;
      detail: {
        characters: { appearances: number[]; name: string }[];
        episodes: {
          no: number;
          scenes: {
            characters: string[];
            location: string;
            text: string;
          }[];
          title: string;
        }[];
        locations: string[];
        props: string[];
      };
      episodeCount: number;
      id: number;
      isCurrent: boolean;
      llmCallId?: null | number;
      locationCount: number;
      model?: null | string;
      /** rule=规则切分（零成本）/ llm=LLM 分析 */
      origin: string;
      sceneCount: number;
      version: number;
    } | null;
    versions: {
      characterCount: number;
      createdAt: string;
      episodeCount: number;
      id: number;
      isCurrent: boolean;
      locationCount: number;
      origin: string;
      sceneCount: number;
      version: number;
    }[];
  }>('/Script/Structure', { params: { dramaId, version } });
}

/** 触发分集（横向④：不依赖洗稿） */
export async function scriptEpisodeSplit(
  dramaId: number,
  providerId?: null | number,
) {
  return api.post<{ taskId: number }>('/ScriptEpisode/Split', {
    dramaId,
    providerId,
  });
}

/**
 * 触发分镜。`episodeNo` 不传 = 全部分集；指定 = 只跑该集。
 * 用户要求「每一集可以进入了 开始分镜」。
 */
export async function shotStoryboard(
  dramaId: number,
  episodeNo?: null | number,
  providerId?: null | number,
) {
  return api.post<{ episodeNo?: null | number; taskId: number }>(
    '/Shot/Storyboard',
    { dramaId, episodeNo, providerId },
  );
}

// ─────────────────────────── Verification ───────────────────────────

/**
 * 程序状态（含 `appTimeZone` = 服务端 appsettings.TimeZone，如 `Asia/Shanghai`）。
 *
 * ⚠️ 前端算「已耗时」时必须知道项目时区：后端所有时间戳都是**项目时区的墙上时间、
 * 不带时区后缀**，与 UTC 的 `Date.now()` 混用会整体偏一个时区
 * （表现为读秒恒为 0 或凭空多跑 8 小时，见 `#/utils/wallTime`）。
 * 故启动时拉一次并 `setProjectTimeZone(...)`。
 */
export async function verificationStatus() {
  return api.get<{
    [k: string]: any;
    appTimeZone?: null | string;
  }>('/Verification/Status', { params: {} });
}
