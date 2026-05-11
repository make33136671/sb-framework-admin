import { api } from '#/api/request';

export async function getList(params: any) {
  return api.get('/RealName/List', { params });
}

export async function postApprove(id: number) {
  return api.post('/RealName/Approve', { id });
}

export async function postReject(id: number, reason?: string) {
  return api.post('/RealName/Reject', { id, reason });
}
