import { useAppConfig } from '@vben/hooks';

import { api } from '#/api/request';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
const serverBase = apiURL.replace(/\/admin$/, '');

export interface BackupProductSummary {
  productEn: string;
  productCn: string;
  logoPath?: string | null;
  primaryDomain?: string | null;
  backupCount: number;
  totalSize: number;
  latestBackupTime: string;
  latestReceivedTime: string;
  clientIps: string[];
}

export interface BackupRemoteRecord {
  id: number;
  productEn: string;
  productCn: string;
  primaryDomain?: string | null;
  logoPath?: string | null;
  clientIp: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  md5?: string | null;
  backupTime: string;
  receivedTime: string;
}

export async function getProductList() {
  return api.get<BackupProductSummary[]>('/BackupReceive/ProductList');
}

export async function getRecordList(params: {
  productEn: string;
  page?: number;
  pageSize?: number;
}) {
  return api.get('/BackupReceive/RecordList', { params });
}

export async function postDelete(id: number) {
  const formData = new FormData();
  formData.append('id', String(id));
  return api.post('/BackupReceive/Delete', formData);
}

/** 下载单个备份文件 (服务端 admin 鉴权) */
export function getDownloadUrl(id: number) {
  return `${apiURL}/BackupReceive/Download/${id}`;
}

/** 服务端 logoPath / filePath 都是 /storage/... 相对路径，转成完整 URL 用 server 根 */
export function toServerUrl(relPath?: string | null) {
  if (!relPath) return '';
  return `${serverBase}${relPath}`;
}
