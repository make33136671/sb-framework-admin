import { useAppConfig } from '@vben/hooks';

import { api } from '#/api/request';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

export interface AppSettingsData {
  path: string;
  rawText: string;
  parsed: Record<string, unknown> | null;
  size: number;
  lastModified: string;
}

export interface AppSettingsHistoryItem {
  fileName: string;
  size: number;
  backupAt: string;
}

export function getAppSettings() {
  return api.get<AppSettingsData>('/AppSettings/Get');
}

export function saveAppSettings(rawText: string, restart = true) {
  return api.post('/AppSettings/Save', { rawText, restart });
}

export function diffAppSettings(rawText: string) {
  return api.post<{ oldText: string; newText: string }>(
    '/AppSettings/Diff',
    { rawText },
  );
}

export function historyAppSettings() {
  return api.get<AppSettingsHistoryItem[]>('/AppSettings/History');
}

export function historyContentAppSettings(fileName: string) {
  return api.get<{ fileName: string; rawText: string }>(
    '/AppSettings/HistoryContent',
    { params: { fileName } },
  );
}

export function rollbackAppSettings(fileName: string, restart = true) {
  return api.post('/AppSettings/Rollback', { fileName, restart });
}

/** 整文件上传（multipart） */
export async function uploadAppSettings(file: File, restart = true) {
  const form = new FormData();
  form.append('file', file);
  form.append('restart', String(restart));
  return api.post('/AppSettings/Upload', form);
}

/** 下载当前 appsettings.json — 直接 URL 给浏览器另存为 */
export function downloadAppSettingsUrl() {
  return `${apiURL}/AppSettings/Download`;
}

// ---- 附带 App 信息 / 重启 endpoint（顺便用，避免 view 引外面）----
export function getAppInfo() {
  return api.get<Record<string, any>>('/App/Info');
}

export function restartApp() {
  return api.post('/App/Restart');
}
