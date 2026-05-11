import { api } from '#/api/request';

/** 获取当前授权状态 */
export async function getStatus() {
  return api.get('/Verification/Status', { params: {} });
}

/** 向授权服务器申请授权 */
export async function requestLicense(domain: string) {
  return api.post('/Verification/RequestLicense', { domain });
}

/** 查询授权服务器是否有新授权 */
export async function checkUpdate() {
  return api.post('/Verification/CheckUpdate', {}, { quiet: true });
}

/** 下载并应用新授权 */
export async function applyLicense(recordId: number) {
  return api.post('/Verification/ApplyLicense', { recordId });
}
