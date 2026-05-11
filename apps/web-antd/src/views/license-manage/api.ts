import { api } from '#/api/request';

// ===== 密钥管理 =====

export async function getPublicKey() {
  return api.get('/Entitlement/GetPublicKey', { params: {} });
}

export async function regenerateKeyPair() {
  return api.post('/Entitlement/RegenerateKeyPair');
}

// ===== 网站客户 =====

export async function getClientList(params: {
  page: number;
  pageSize: number;
  keyword?: string;
}) {
  return api.get('/Entitlement/ClientList', { params });
}

export async function getClientDetail(id: number) {
  return api.get('/Entitlement/ClientDetail', { params: { id } });
}

export async function editClient(data: {
  id: number;
  name?: string;
  remark?: string;
  status?: number;
}) {
  const query = new URLSearchParams();
  query.set('id', String(data.id));
  if (data.name != null) query.set('name', data.name);
  if (data.remark != null) query.set('remark', data.remark);
  if (data.status != null) query.set('status', String(data.status));
  return api.post(`/Entitlement/ClientEdit?${query.toString()}`, {});
}

/** 软删客户. 历史 Record/VerifyLog 保留, 全局过滤器自动隐藏. */
export async function deleteClient(id: number) {
  return api.post(`/Entitlement/DeleteClient?id=${id}`, {});
}

// ===== 授权申请 =====

export async function getRequestList(params: {
  page: number;
  pageSize: number;
  status?: number;
}) {
  return api.get('/Entitlement/RequestList', { params });
}

export async function approveRequest(data: {
  requestId: number;
  expiresAt: string;
  verifyMode?: number;
  allowedRoutes?: string[];
}) {
  // allowedRoutes 通过 body 传递
  const { requestId, expiresAt, verifyMode, allowedRoutes } = data;
  return api.post(
    `/Entitlement/ApproveRequest?requestId=${requestId}&expiresAt=${encodeURIComponent(expiresAt)}&verifyMode=${verifyMode ?? 2}`,
    allowedRoutes ?? [],
  );
}

export async function rejectRequest(data: {
  requestId: number;
  reason?: string;
}) {
  const query = new URLSearchParams({ requestId: String(data.requestId) });
  if (data.reason) query.set('reason', data.reason);
  return api.post(`/Entitlement/RejectRequest?${query.toString()}`, {});
}

// ===== 授权记录 =====

export async function getRecordList(params: {
  page: number;
  pageSize: number;
  clientId?: number;
}) {
  return api.get('/Entitlement/RecordList', { params });
}

/** 签发授权请求. 各字段空 = 不验证该项. */
export interface IssueLicenseRequest {
  clientId: number;
  expiresAt: string; // ISO
  domains?: string[];
  productEn?: string;
  clientKey?: string;
  hardwareId?: string;
  allowedRoutes?: string[];
  /** 到期后是否仍允许访问管理后台 (/admin/* 非白名单路径) */
  allowAdminAfterExpiry?: boolean;
  /** 到期后是否仍允许访问客户端 API (/api/* 非白名单路径) */
  allowClientApiAfterExpiry?: boolean;
}

/** 统一签发授权 (IssueLicenseRequest JSON body). */
export async function issueLicense(data: IssueLicenseRequest) {
  const baseURL = import.meta.env.VITE_GLOB_API_URL || '/admin';
  const { useAccessStore } = await import('@vben/stores');
  const token = useAccessStore().accessToken;
  const res = await fetch(`${baseURL}/Entitlement/IssueLicense`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.message || '签发失败');
  return json.data;
}

export async function revokeLicense(recordId: number) {
  return api.post(`/Entitlement/RevokeLicense?recordId=${recordId}`, {});
}

// ===== 快速签发 =====

export async function quickGenerate(data: {
  productEn?: string;
  productCn?: string;
  clientKey?: string;
  hardwareId?: string;
  domain?: string;
  machineName?: string;
  days?: number;
  expiresAt?: string;
  verifyMode?: number;
}) {
  // QuickGenerate 用 [FromBody] JSON 接收, 绕开默认 api 客户端的 form-urlencoded Content-Type
  const baseURL = import.meta.env.VITE_GLOB_API_URL || '/admin';
  const token = (await import('@vben/stores')).useAccessStore().accessToken;
  const res = await fetch(`${baseURL}/Entitlement/QuickGenerate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.message || '签发失败');
  return json.data;
}

// ===== 验证日志 =====

export async function getVerifyLogList(params: {
  page: number;
  pageSize: number;
  clientId?: number;
}) {
  return api.get('/Entitlement/VerifyLogList', { params });
}
