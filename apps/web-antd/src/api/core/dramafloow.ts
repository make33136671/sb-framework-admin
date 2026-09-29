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
  seed: number;
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
  clip?: {
    id: number;
    videoPath?: string;
    durationSec?: number;
    status: string;
    error?: string;
  } | null;
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

export interface TaskDetail extends TaskItem {
  /** 剧目名（Task/Get 带出） */
  dramaName?: string;
  /** 该任务的 LLM token 汇总 */
  tokens?: null | TaskTokenSummary;
  versions: {
    id: number;
    versionNo: number;
    promptSnapshot?: string;
    seed?: number;
    status: string;
    failReason?: string;
    submittedAt: string;
  }[];
  jobs: {
    id: number;
    comfyuiPromptId?: string;
    workflowKey: string;
    variantNo: number;
    seed: number;
    status: string;
    error?: string;
    submittedAt: string;
    completedAt?: string;
  }[];
}

/** tokens 桶（今日 / 近 7 天共用形状） */
export interface TokenBucket {
  prompt: number;
  completion: number;
  calls: number;
  failedCalls: number;
}

export interface DashboardMetrics {
  throughput: { today: number; week: number; trend: number[] };
  rejectRate: { image: number; video: number; windowDays: number };
  reviewBacklog: {
    pending: number;
    oldestHours: number;
    byKind: { image: number; video: number; drama: number };
  };
  gpu: { inFlight: number; queue: number; windowOpen: boolean; window: string };
  eta: { remainingTasks: number; estHours: number };
  /** 第 6 指标（设计 §B）：AI tokens 消耗 */
  tokens: {
    today: TokenBucket;
    week: TokenBucket;
    trend: {
      date: string;
      prompt: number;
      completion: number;
      calls: number;
    }[];
    byPurpose: {
      purpose: string;
      calls: number;
      tokens: number;
      avgLatencyMs: number;
    }[];
    /** 估算调用数 / 实测调用数（数据可信性，P0 配套） */
    estimated: number;
    measured: number;
  };
}

/** D 区：待我决策（轻量预览，设计 §D） */
export interface PendingDecisions {
  images: {
    requirementId: number;
    requirementKey?: string;
    kind?: string;
    dramaId: number;
    dramaName?: string;
    version: number;
    candidateCount: number;
    previews: { candidateId: number; filePath?: string }[];
  }[];
  videos: {
    clipId: number;
    dramaId: number;
    dramaName?: string;
    shotId: number;
    status: string;
    error?: string;
    videoPath?: string;
  }[];
  products: {
    episodeId: number;
    dramaId: number;
    dramaName?: string;
    episodeNo: number;
    coverPath?: string;
    videoPath?: string;
    durationSec?: number;
  }[];
  scripts: {
    scriptId: number;
    dramaId: number;
    dramaName?: string;
    version: number;
    status: string;
  }[];
  counts: {
    images: number;
    videos: number;
    products: number;
    scripts: number;
    total: number;
  };
}

/** E 区：AI 消耗（设计 §E） */
export interface TokenUsage {
  range: { days: number; from: string; to: string };
  today: TokenBucket;
  totals: TokenBucket;
  trend: {
    date: string;
    prompt: number;
    completion: number;
    calls: number;
    failedCalls: number;
  }[];
  byModel: {
    model: string;
    provider?: string;
    prompt: number;
    completion: number;
    calls: number;
    failedCalls: number;
    avgLatencyMs: number;
  }[];
  byPurpose: {
    purpose: string;
    prompt: number;
    completion: number;
    calls: number;
    failedCalls: number;
    avgLatencyMs: number;
  }[];
  recentErrors: {
    purpose: string;
    model?: string;
    provider?: string;
    error?: string;
    createdAt: string;
  }[];
  /** 数据可信性：估算 vs 实测调用数、涉及的 provider */
  quality: {
    estimatedCalls: number;
    measuredCalls: number;
    providers: string[];
  };
}

export interface NightReport {
  window: { start: string; end: string };
  submitted: number;
  completed: number;
  failed: number;
  rejected: number;
  taskCount: number;
  durationMinutes: {
    count: number;
    min: number;
    median: number;
    p90: number;
    max: number;
  };
  topRejectReasons: {
    reasonId: number;
    code?: string;
    name?: string;
    count: number;
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
  seed?: number;
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
  keyword?: string;
  status?: string;
  archived?: boolean;
  page?: number;
  pageSize?: number;
}) {
  return api.get<{ items: DramaItem[]; total: number }>('/Drama/List', {
    params,
  });
}

export async function dramaGet(id: number) {
  return api.get<DramaDetail>('/Drama/Get', { params: { id } });
}

export async function dramaAdd(data: {
  code?: string;
  name: string;
  genre?: string;
  synopsis?: string;
  episodeTargetCount?: number;
}) {
  return api.post<{ id: number }>('/Drama/Add', data);
}

export async function dramaUpdate(data: {
  id: number;
  name: string;
  genre?: string;
  synopsis?: string;
  episodeTargetCount?: number;
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
  metadata: { title: string; author: string; created: string };
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
  return api.post<{ id: number; version: number; charCount: number }>(
    '/Script/ImportWord',
    formData,
  );
}

export async function scriptRewrite(dramaId: number) {
  return api.post<{ taskId: number }>('/Script/Rewrite', { dramaId });
}

export async function scriptVersionList(dramaId: number) {
  return api.get<
    {
      id: number;
      version: number;
      episodeCount: number;
      model?: string;
      status: string;
      hasRewritten: boolean;
      createdAt: string;
    }[]
  >('/Script/VersionList', { params: { dramaId } });
}

export async function scriptCompare(
  dramaId: number,
  versionA: number,
  versionB: number,
) {
  return api.get<{
    a: { version: number; episodeCount: number; sourceLength: number };
    b: { version: number; episodeCount: number; sourceLength: number };
    sourceIdentical: boolean;
    episodes: {
      episodeNo: number;
      aScenes: number;
      bScenes: number;
      changed: boolean;
    }[];
  }>('/Script/Compare', { params: { dramaId, versionA, versionB } });
}

// ─────────────────────────── Shot ───────────────────────────

export async function shotList(params: {
  dramaId: number;
  scriptVersion?: number;
  episodeNo?: number;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  return api.get<{ items: ShotItem[]; total: number }>('/Shot/List', {
    params,
  });
}

export async function shotGet(id: number) {
  return api.get<{
    shot: ShotItem;
    assets: {
      id: number;
      key: string;
      kind: string;
      status: string;
      approvedAssetId?: number;
    }[];
    tasks: TaskItem[];
  }>('/Shot/Get', { params: { id } });
}

export async function shotSave(data: Record<string, any>) {
  return api.post('/Shot/Save', data);
}

export async function shotStaleReplay(id: number) {
  return api.post<{ taskId: number; version: number }>('/Shot/StaleReplay', {
    id,
  });
}

// ─────────────────────────── Asset ───────────────────────────

export async function assetRequirementList(params: {
  dramaId: number;
  kind?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  /** 默认只看当前生效版本；传 false 可列出全部历史版本 */
  currentOnly?: boolean;
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
export async function assetExtractStart(dramaId: number) {
  return api.post<{ taskId: number }>('/Asset/ExtractStart', { dramaId });
}

export async function assetRequirementGet(id: number) {
  return api.get<{
    requirement: AssetRequirementItem;
    candidates: AssetCandidateItem[];
    reasons: ReasonItem[];
    tasks: TaskItem[];
  }>('/Asset/RequirementGet', { params: { id } });
}

export async function assetRequirementSave(data: {
  id?: number;
  dramaId: number;
  kind: string;
  name: string;
  description?: string;
  spec?: string;
}) {
  return api.post<{ id: number }>('/Asset/RequirementSave', data);
}

export async function assetCandidateList(requirementId: number) {
  return api.get<AssetCandidateItem[]>('/Asset/CandidateList', {
    params: { requirementId },
  });
}

export async function assetGenerate(requirementId: number) {
  return api.post<{ taskId: number; version: number }>('/Asset/Generate', {
    requirementId,
  });
}

export async function assetApprove(candidateId: number) {
  return api.post<{ staled: number }>('/Asset/Approve', { candidateId });
}

export async function assetReject(
  candidateId: number,
  reasonId: number,
  note?: string,
) {
  return api.post('/Asset/Reject', { candidateId, reasonId, note });
}

export async function assetToLibrary(candidateId: number, tags?: string) {
  return api.post<{ id: number }>('/Asset/ToLibrary', { candidateId, tags });
}

export async function assetLibraryList(params: {
  kind?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  return api.get<{
    items: {
      id: number;
      sourceCandidateId: number;
      key: string;
      kind: string;
      filePath: string;
      tags?: string;
      createdAt: string;
    }[];
    total: number;
  }>('/Asset/LibraryList', { params });
}

// ─────────────────────────── Task ───────────────────────────

export async function taskList(params: {
  dramaId?: number;
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  return api.get<{ items: TaskItem[]; total: number }>('/Task/List', {
    params,
  });
}

export async function taskGet(id: number) {
  return api.get<TaskDetail>('/Task/Get', { params: { id } });
}

export async function taskRetry(id: number) {
  return api.post<{ taskId: number; version: number }>('/Task/Retry', { id });
}

export async function taskCancel(id: number) {
  return api.post('/Task/Cancel', { id });
}

/** 重新生成：任意状态都可再跑一版（开新版本、保留历史），用于"结果不满意，重做" */
export async function taskRegenerate(id: number, note?: string) {
  return api.post<{ taskId: number; version: number }>('/Task/Regenerate', {
    id,
    note,
  });
}

/** 删除子任务（保留记录可追溯；在飞任务需先取消） */
export async function taskDelete(id: number, reason?: string) {
  return api.post('/Task/Delete', { id, reason });
}

/** 手动修改子任务常用字段（备注/进度） */
export async function taskUpdate(data: {
  id: number;
  error?: string;
  progress?: number;
}) {
  return api.post('/Task/Update', data);
}

export async function taskStats(dramaId?: number) {
  return api.get<{
    total: number;
    queued: number;
    inFlightT2i: number;
    inFlightI2v: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    recentFailures: TaskItem[];
    /** 未终态任务的 token 汇总：taskId → 汇总（看板显示在跑任务烧了多少 token） */
    tokensByTask: Record<number, TaskTokenSummary>;
  }>('/Task/Stats', { params: dramaId ? { dramaId } : {} });
}

// ─────────────────────────── Review ───────────────────────────

export async function reviewQueue(params: {
  dramaId?: number;
  target?: string;
  page?: number;
  pageSize?: number;
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
    id: number;
    decision: string;
    reasonId?: number;
    note?: string;
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
  purpose?: string;
  model?: string;
}) {
  return api.get<TokenUsage>('/Dashboard/TokenUsage', { params });
}

// ─────────────────────────── Template ───────────────────────────

export async function templateWorkflowList() {
  return api.get<WorkflowTemplateItem[]>('/Template/WorkflowList');
}

export async function templateWorkflowSave(data: {
  id?: number;
  key: string;
  name: string;
  template: string;
  isActive?: boolean;
}) {
  return api.post<{ id: number }>('/Template/WorkflowSave', data);
}

export async function templateLlmList() {
  return api.get<LlmTemplateItem[]>('/Template/LlmList');
}

export async function templateLlmSave(data: {
  id?: number;
  key: string;
  template: string;
  purpose?: string;
  isActive?: boolean;
}) {
  return api.post<{ id: number }>('/Template/LlmSave', data);
}

export async function templateReasonList(scope?: string) {
  return api.get<ReasonItem[]>('/Template/ReasonList', {
    params: scope ? { scope } : {},
  });
}

export async function templateLlmCallLogs(params: {
  purpose?: string;
  page?: number;
  pageSize?: number;
}) {
  return api.get<{
    items: {
      id: number;
      purpose: string;
      provider: string;
      model?: string;
      requestHash: string;
      promptTokens: number;
      completionTokens: number;
      latencyMs: number;
      error?: string;
      createdAt: string;
    }[];
    total: number;
  }>('/Template/LlmCallLogs', { params });
}

// ─────────────────────────── Product ───────────────────────────

export async function productEpisodeList(dramaId: number) {
  return api.get<{
    dramaId: number;
    dramaName: string;
    episodeTargetCount: number;
    scriptVersion: number;
    clipDone: number;
    episodes: ProductEpisodeItem[];
  }>('/Product/EpisodeList', { params: { dramaId } });
}

export async function productRender(dramaId: number) {
  return api.post<{ taskId: number; version: number; clipDone: number }>(
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
