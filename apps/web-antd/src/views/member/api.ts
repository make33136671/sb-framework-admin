import { api } from '#/api/request';

export async function getList(params: any) {
  return api.get('/Member/List', { params });
}

export async function getDetail(id: number) {
  return api.get('/Member/Detail', { params: { id } });
}

export async function postAdd(data: any) {
  return api.post('/Member/Add', data);
}

export async function postEdit(params: any) {
  return params.id ? api.post('/Member/Edit', params) : postAdd(params);
}

export async function postDel(id: any) {
  return api.post('/Member/Del', { id });
}

export async function postResetPassword(id: number, newPassword: string) {
  return api.post('/Member/ResetPassword', { id, newPassword });
}

export async function getMemberTree(memberId: number) {
  return api.get('/Member/MemberTree', { params: { memberId } });
}

export async function getChildren(parentId?: number) {
  return api.get('/Member/Children', {
    params: parentId == null ? {} : { parentId },
  });
}

export async function getSearch(keyword: string) {
  return api.get('/Member/Search', { params: { keyword } });
}
