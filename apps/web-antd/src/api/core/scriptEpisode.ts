/**
 * 剧本「按集版本」与选区重洗接口
 *
 * 版本口径（与后端 ScriptEpisode 一致）：**每集独立记版本号**
 *   整本洗稿 → 每集都是 100；局部重洗第 2 集 → 第 2 集变 100.1，第 3 集变 101.1，其余集不动。
 */
import { api } from '#/api/request';

/** 单集版本行 */
export interface ScriptEpisodeRow {
  id: number;
  dramaId: number;
  episodeNo: number;
  majorVersion: number;
  minorVersion: number;
  /** 展示版本号：100 或 100.1 */
  version: string;
  title?: null | string;
  /** 该集内容（JSON 场景数组） */
  content: string;
  /** rewrite=整本洗稿落集；partial=选区重洗 */
  origin: string;
  isCurrent: boolean;
  llmCallId?: null | number;
  createdAt: string;
}

/** 选区重洗的影响预览 */
export interface PartialRewritePlan {
  majorVersion: number;
  selectionLength: number;
  episodes: {
    current: string;
    episodeNo: number;
    next: string;
    sourceLength: number;
  }[];
}

export async function scriptEpisodeList(dramaId: number) {
  return api.get<ScriptEpisodeRow[]>('/ScriptEpisode/EpisodeList', {
    params: { dramaId },
  });
}

export async function scriptEpisodeHistory(dramaId: number, episodeNo: number) {
  return api.get<ScriptEpisodeRow[]>('/ScriptEpisode/EpisodeHistory', {
    params: { dramaId, episodeNo },
  });
}

/** 单集回退到指定历史版本 */
export async function scriptEpisodeSetCurrent(
  dramaId: number,
  episodeNo: number,
  id: number,
) {
  return api.post<{ version: string }>('/ScriptEpisode/EpisodeSetCurrent', {
    dramaId,
    episodeNo,
    id,
  });
}

/** 只预览：选区会影响哪几集、各变成什么版本号（不入队） */
export async function scriptPartialPlan(
  dramaId: number,
  start: number,
  end: number,
) {
  return api.get<PartialRewritePlan>('/ScriptEpisode/Plan', {
    params: { dramaId, start, end },
  });
}

/** 提交选区重洗（入队） */
export async function scriptPartialRewrite(data: {
  dramaId: number;
  end: number;
  providerId?: null | number;
  /** 洗稿细化选项 JSON */
  rewriteOptions?: null | string;
  start: number;
}) {
  return api.post<{
    episodes: { episodeNo: number; next: string }[];
    taskId: number;
  }>('/ScriptEpisode/PartialRewrite', data);
}
