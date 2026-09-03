import { useAppConfig } from '@vben/hooks';

import { api } from '#/api/request';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
const serverBase = apiURL.replace(/\/admin$/, '');

export interface BackupProductSummary {
  productEn: string;
  productCn: string;
  logoPath?: null | string;
  primaryDomain?: null | string;
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
  primaryDomain?: null | string;
  logoPath?: null | string;
  clientIp: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  md5?: null | string;
  backupTime: string;
  receivedTime: string;
}

export async function getProductList() {
  return api.get<BackupProductSummary[]>('/BackupReceive/ProductList');
}

export async function getRecordList(params: {
  page?: number;
  pageSize?: number;
  productEn: string;
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
export function toServerUrl(relPath?: null | string) {
  if (!relPath) return '';
  return `${serverBase}${relPath}`;
}
