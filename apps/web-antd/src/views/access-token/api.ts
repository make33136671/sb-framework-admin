import { api } from '#/api/request';

// /admin/AccessToken/* — 框架统一访问令牌(SB.Feature.AccessToken),取代原 /admin/AgentToken/*

export async function getList(params: {
  keyword?: string;
  accountId?: number;
  page?: number;
  pageSize?: number;
}) {
  return api.get('/AccessToken/List', { params });
}

export async function getDetail(id: number) {
  return api.get('/AccessToken/Detail', { params: { id } });
}

export interface CreateForm {
  name: string;
  // 绑定已有账号 二选一:accountId 或 serviceAccount(服务账号用户名,不存在则自动建)
  accountId?: number;
  serviceAccount?: string;
  scopes?: string;
  fullAccess?: boolean;
  expiresAt?: string;
  rateLimitPerMinute?: number;
  ipAllowlist?: string;
  notes?: string;
}

export async function postCreate(data: CreateForm) {
  // 响应 data 含一次性 token 明文,调用方应立即弹出让用户复制
  return api.post('/AccessToken/Create', data);
}

export interface UpdateForm {
  id: number;
  name?: string;
  scopes?: string;
  expiresAt?: string;
  rateLimitPerMinute?: number;
  ipAllowlist?: string;
  notes?: string;
}

export async function postUpdate(data: UpdateForm) {
  return api.post('/AccessToken/Update', data);
}

export async function postRevoke(id: number, reason?: string) {
  return api.post('/AccessToken/Revoke', { id, reason });
}

export async function getAudit(params: {
  keyId?: number;
  action?: string;
  page?: number;
  pageSize?: number;
}) {
  return api.get('/AccessToken/Audit', { params });
}
