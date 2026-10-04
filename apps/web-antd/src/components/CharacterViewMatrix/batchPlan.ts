/**
 * 「一键生成 7 图」的**纯逻辑**（用户 2026-10-04 要求）
 *
 * > 「角色视图 一个角色名旁边 右侧 加一个 一键生成 7图（旁边加一个 checked 自动定稿）
 * >  自动按照全默认参数 但是每个视图生成 1 张就好 把 7 张图 补齐」
 *
 * 语义（用户已确认）：
 *   · **全默认参数**：张数 = 每视图 1 张；尺寸 = 该视图的默认（后端系统设置优先）；
 *     线路 = 自动（不指定 providerId，走该能力的默认服务）；
 *   · **补齐**：已经有图（已定稿）的视图**跳过**，只补空格子；
 *   · **自动定稿**（勾选时）：每视图出图后取第 1 张候选自动通过并定稿。
 *
 * ⚠️ 这里刻意不碰网络/组件：批量的**判据**（该给哪些视图发任务、要不要等）
 * 全是纯函数，这样能被单测锁住 —— 这类"跳过/不跳过"的判据一旦写错，
 * 表现是"静默少生成几张"或"把已有定稿冲掉"，都不会报错。
 */

import type {
  CharacterMatrix,
  CharacterMatrixRow,
} from '#/api/core/dramafloow';

/** 一个待生成的视图（已过滤掉不该生成的）。 */
export interface ViewToGenerate {
  /** 该视图的素材需求 id（提交任务时的 refEntityId） */
  requirementId: number;
  /** 视图后缀（face_front / full_body_front …）—— 回填结果时用 */
  suffix: string;
  /** 视图中文名（给用户看） */
  label: string;
  /** 该视图的定稿图（用于判断"是否已有"） */
  approvedAssetId?: null | number;
  /** 正向（第 3 层）：视图 spec */
  spec?: string;
  /** 反向（第 3 层）：通用底线 + 视图专有 */
  negativeSpec?: string;
  /** 尺寸（系统设置优先，后端已解析好） */
  width?: number;
  height?: number;
}

/**
 * 排出「这个角色还需要生成哪些视图」。
 *
 * 判据（与用户描述逐条对应）：
 *   · **已有定稿图 → 跳过**（"把 7 张图补齐"，不是"重出 7 张"）；
 *   · **没有需求档案 → 跳过并单独报告**（`requirementId` 为空说明这个视图
 *     还没建档，此时发任务会因为 `refEntityId` 缺失而挂不上产物 ——
 *     那种"图生成了但不知道给谁"比直接不发更难查）；
 *   · 其余（有档案、格子空）→ 待生成。
 *
 * ⚠️ 视图的 spec / 反向 / 尺寸**不在格子里**，而在 `viewColumns` 上
 * （后端只在列定义里给一次，避免每格重复）。这里按 suffix 关联 ——
 * 不关联的话，提交出去的 `subjectPrompt` 全是空，生成出来的图与视图无关，
 * 而**不会有任何报错**。
 *
 * @param row 矩阵里的一行（一个角色）
 * @param viewColumns 列定义（含 spec / 尺寸）
 * @returns `todo` 待生成视图；`skippedFilled` / `skippedNoRequirement` 两类跳过计数
 */
export function planViewsToGenerate(
  row: CharacterMatrixRow,
  viewColumns: CharacterMatrix['viewColumns'] = [],
): {
  skippedFilled: number;
  skippedNoRequirement: number;
  todo: ViewToGenerate[];
} {
  const todo: ViewToGenerate[] = [];
  let skippedFilled = 0;
  let skippedNoRequirement = 0;

  const colOf = (suffix: string) =>
    viewColumns.find((c) => c.suffix === suffix) ?? null;

  for (const cell of row.views) {
    if (!cell.requirementId) {
      skippedNoRequirement++;
      continue;
    }
    if (cell.approvedAssetId) {
      skippedFilled++;
      continue;
    }
    const col = colOf(cell.suffix);
    todo.push({
      requirementId: cell.requirementId,
      suffix: cell.suffix,
      label: cell.label,
      approvedAssetId: cell.approvedAssetId,
      spec: col?.spec,
      negativeSpec: col?.negativeSpec,
      width: col?.width,
      height: col?.height,
    });
  }

  return { todo, skippedFilled, skippedNoRequirement };
}

/** 批量生成的每个视图的一行状态（弹窗里展示）。 */
export type BatchItemStatus =
  | 'approved' // 已自动定稿
  | 'candidate-ready' // 出图完成，等人工挑选
  | 'failed' // 下发或生成失败
  | 'pending' // 还没开始
  | 'submitted'; // 任务已建，等出图

export interface BatchItemState {
  label: string;
  /** 后端回执里的候选张数（自动定稿时用得上） */
  message?: string;
  status: BatchItemStatus;
  suffix: string;
  taskId?: number;
}

/** 从一批候选里挑"第 1 张"用于自动定稿（后端按 variant_no 排序，取首个）。 */
export function firstCandidateId(
  candidates: null | undefined | { id: number; variantNo?: number }[],
): null | number {
  if (!candidates || candidates.length === 0) return null;
  const sorted = [...candidates].toSorted(
    (a, b) => (a.variantNo ?? 0) - (b.variantNo ?? 0),
  );
  return sorted[0]?.id ?? null;
}
