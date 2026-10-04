/**
 * 业务枚举 → 中文展示（**全站唯一事实源**）
 *
 * 背景（2026-10-04 用户要求）：
 *   界面上**不得出现英文枚举值**（如 `asset_extract` / `pending_review` / `local_gpu`）。
 *   后端枚举/代码层面保持英文不变（TaskTypes 等常量仍是英文），只在前端展示层翻译。
 *
 * 用法：
 *   ```ts
 *   import { enumText } from '#/composables/useEnumText';
 *   enumText.taskType('asset_extract')   // → '素材提取'
 *   enumText.taskStatus('pending_review') // → '已出图待定稿'
 *   ```
 *
 * ⚠️ 新增后端枚举值时，必须同步本文件的对应表（漏了会走 `unknown()` 兜底，
 *    显示成「未知(xxx)」而不是裸英文 —— 便于一眼看出漏配，又不会把英文暴露给用户）。
 */

/** 兜底：不显示裸英文，明确标注未知值便于排查 */
function unknown(v?: null | string): string {
  return v ? `未知（${v}）` : '-';
}

/** 任务类型（后端 TaskTypes，9 种） */
export const TASK_TYPE_TEXT: Record<string, string> = {
  t2i: '素材出图',
  i2v: '片段生成',
  rewrite: '洗稿',
  partial_rewrite: '选区重洗',
  analyze: '剧本分析',
  episode_split: '分集拆分',
  storyboard: '分镜',
  asset_extract: '素材提取',
  concat: '成片合并',
};

/** 任务状态（后端 TaskStatuses，9 种） */
export const TASK_STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  preparing: '准备中',
  generating: '生成中',
  collecting: '收集中',
  // ⚠️ 后端状态值叫 pending_review，但它**不是**"任务还在等审核"：
  // 编排器出完图写这个状态后，**没有任何代码再把任务推进出去**
  // （全仓搜不到给任务写 approved 的地方）。人工审核实际发生在
  // **素材候选**上（asset_candidate），与任务状态机无关。
  //
  // 旧文案「待审核」让用户以为"任务还会变、要继续等下去"，正是这个标签
  // 一直看不懂的根因（用户 2026-10-04 反馈并自行点破：
  // 「他并不与当前的 AI 任务存在状态关联 他是素材任务链上的」）。
  // 故改为如实描述它此刻的事实：图已出完，任务到此为止。
  //
  // 注意区分：`CANDIDATE_STATUS_TEXT.pending` 的「待审核」是**对的**
  // （那才是真正等人工处理的素材候选）。
  pending_review: '已出图待定稿',
  approved: '已通过',
  rejected: '已驳回',
  failed: '失败',
  done: '已完成',
};

/** 剧目状态（DramaStatuses） */
export const DRAMA_STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  producing: '制作中',
  review: '待审核',
  done: '已完成',
  archived: '已归档',
};

/** 剧本状态（ScriptStatuses） */
export const SCRIPT_STATUS_TEXT: Record<string, string> = {
  pending: '待处理',
  rewriting: '洗稿中',
  done: '已完成',
};

/** 分镜状态（ShotStatuses） */
export const SHOT_STATUS_TEXT: Record<string, string> = {
  pending: '待处理',
  generating: '生成中',
  done: '已完成',
  stale: '已失效',
};

/** 素材需求状态（RequirementStatuses） */
export const REQUIREMENT_STATUS_TEXT: Record<string, string> = {
  pending: '待生成',
  generating: '生成中',
  approved: '已通过',
  rejected: '已驳回',
};

/** 候选图状态（CandidateStatuses） */
export const CANDIDATE_STATUS_TEXT: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  failed: '失败',
};

/** 片段状态（ClipStatuses） */
export const CLIP_STATUS_TEXT: Record<string, string> = {
  generating: '生成中',
  done: '已完成',
  stale: '已失效',
  failed: '失败',
};

/** 成片状态（ProductStatuses） */
export const PRODUCT_STATUS_TEXT: Record<string, string> = {
  rendering: '合成中',
  done: '已完成',
  failed: '失败',
};

/** 后台作业状态（JobStatuses） */
export const JOB_STATUS_TEXT: Record<string, string> = {
  submitted: '已提交',
  running: '运行中',
  done: '已完成',
  failed: '失败',
};

/** 素材种类（AssetKinds） */
export const ASSET_KIND_TEXT: Record<string, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
};

/** 驳回原因作用域（ReasonScopes） */
export const REASON_SCOPE_TEXT: Record<string, string> = {
  image: '图片',
  video: '视频',
  drama: '剧目',
};

/** 算力节点类型（NodeTypes） */
export const NODE_TYPE_TEXT: Record<string, string> = {
  local_gpu: '本地 GPU',
  cloud: '云端',
  edge: '边缘',
  super: '超算',
};

/** 服务运行态（ServiceRunStatus） */
export const RUN_STATUS_TEXT: Record<string, string> = {
  idle: '空闲',
  busy: '忙碌',
  offline: '离线',
};

/** 任务来源（TaskSource） */
export const TASK_SOURCE_TEXT: Record<string, string> = {
  system: '系统',
  user: '用户',
};

/** 能力来源（CapabilitySource） */
export const CAPABILITY_SOURCE_TEXT: Record<string, string> = {
  metadata: '接口元数据',
  probed: '问模型自述',
  manual: '手工勾选',
};

/** 结构分析来源（StructureOrigins） */
export const STRUCTURE_ORIGIN_TEXT: Record<string, string> = {
  rule: '规则切分',
  llm: 'LLM 分析',
};

/** 上云执行路由（P13 §8.7） */
export const ROUTE_TEXT: Record<string, string> = {
  local: '本地',
  cloud: '云端',
};

/** 上云决策（CloudDecisionSnapshot.decision） */
export const CLOUD_DECISION_TEXT: Record<string, string> = {
  CloudUpshift: '已上云',
  CloudHold: '未上云',
};

/** 通用 pick：有映射取中文，无映射走「未知(xxx)」兜底（**绝不显示裸英文**） */
export function pick(map: Record<string, string>, v?: null | string): string {
  if (!v) return '-';
  return map[v] ?? unknown(v);
}

/**
 * 统一的枚举翻译入口（各页面按语义调用，避免各处再重复拼 map）。
 * 注意：无法归类的 `status` 用 `pickStatus`（按语义选表），
 *       实在不确定就显式传表，别硬猜。
 */
export const enumText = {
  /** 任务类型：asset_extract → 素材提取 */
  taskType: (v?: null | string) => pick(TASK_TYPE_TEXT, v),
  /** 任务状态：pending_review → 已出图待定稿（不是"任务还在等审核"，见上） */
  taskStatus: (v?: null | string) => pick(TASK_STATUS_TEXT, v),
  dramaStatus: (v?: null | string) => pick(DRAMA_STATUS_TEXT, v),
  scriptStatus: (v?: null | string) => pick(SCRIPT_STATUS_TEXT, v),
  shotStatus: (v?: null | string) => pick(SHOT_STATUS_TEXT, v),
  requirementStatus: (v?: null | string) => pick(REQUIREMENT_STATUS_TEXT, v),
  candidateStatus: (v?: null | string) => pick(CANDIDATE_STATUS_TEXT, v),
  clipStatus: (v?: null | string) => pick(CLIP_STATUS_TEXT, v),
  productStatus: (v?: null | string) => pick(PRODUCT_STATUS_TEXT, v),
  jobStatus: (v?: null | string) => pick(JOB_STATUS_TEXT, v),
  assetKind: (v?: null | string) => pick(ASSET_KIND_TEXT, v),
  reasonScope: (v?: null | string) => pick(REASON_SCOPE_TEXT, v),
  nodeType: (v?: null | string) => pick(NODE_TYPE_TEXT, v),
  runStatus: (v?: null | string) => pick(RUN_STATUS_TEXT, v),
  taskSource: (v?: null | string) => pick(TASK_SOURCE_TEXT, v),
  capabilitySource: (v?: null | string) => pick(CAPABILITY_SOURCE_TEXT, v),
  structureOrigin: (v?: null | string) => pick(STRUCTURE_ORIGIN_TEXT, v),
  route: (v?: null | string) => pick(ROUTE_TEXT, v),
  cloudDecision: (v?: null | string) => pick(CLOUD_DECISION_TEXT, v),
  /** 任意表 + 值（特殊场景） */
  pick,
};
