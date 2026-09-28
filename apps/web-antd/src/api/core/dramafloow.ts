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
  kind: string;
  description?: string;
  spec?: string;
  status: string;
  approvedAssetId?: number;
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

export interface TaskDetail extends TaskItem {
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
}) {
  return api.get<{ items: AssetRequirementItem[]; total: number }>(
    '/Asset/RequirementList',
    { params },
  );
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

export async function taskStats(dramaId?: number) {
  return api.get<{
    total: number;
    queued: number;
    inFlightT2i: number;
    inFlightI2v: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    recentFailures: TaskItem[];
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
