import { useAppConfig } from '@vben/hooks';
import { useAccessStore } from '@vben/stores';

import { api } from '#/api/request';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

/** 服务器基础地址（去掉 /admin 后缀） */
const serverBase = apiURL.replace(/\/admin$/, '');

export async function checkBackup() {
  return api.get('/Database/CheckBackup');
}

export async function postBackup() {
  return api.post('/Database/Backup', {});
}

export async function getList(params: { page: number; pageSize: number }) {
  return api.get('/Database/List', { params });
}

export async function postDel(id: number, filePath?: string) {
  const formData = new FormData();
  formData.append('id', String(id));
  if (filePath) formData.append('filePath', filePath);
  return api.post('/Database/Del', formData);
}

export async function postRestore(id: number, filePath?: string) {
  const formData = new FormData();
  formData.append('id', String(id));
  if (filePath) formData.append('filePath', filePath);
  return api.post('/Database/Restore', formData);
}

/** 恢复后建议立即重启 API（清掉 ORM 缓存的旧 schema） */
export async function postRestart() {
  return api.post('/App/Restart', {}, { silent: true });
}

/** 手动上传/重试上传 单条本地备份到云端 */
export async function postUploadToCloud(id: number) {
  const formData = new FormData();
  formData.append('id', String(id));
  return api.post('/Database/UploadToCloud', formData);
}

/** 按 key 查单条系统设置（用于读 backup_upload_enabled 等开关） */
export async function getSettingByKey(key: string) {
  return api.get('/SystemSetting/GetByKey', { params: { key } });
}

/** 获取备份文件的完整下载地址 */
export function getDownloadUrl(filePath: string) {
  return `${serverBase}${filePath}`;
}

/** 触发浏览器下载备份文件 */
export function downloadFile(filePath: string, fileName: string) {
  const url = getDownloadUrl(filePath);
  const accessStore = useAccessStore();
  // 使用 fetch + blob 方式下载（携带 token，兼容需要认证的场景）
  fetch(url, {
    headers: { Authorization: `Bearer ${accessStore.accessToken}` },
  })
    .then((res) => {
      if (!res.ok) throw new Error('下载失败');
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
    });
}
