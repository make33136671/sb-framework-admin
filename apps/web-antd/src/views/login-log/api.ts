import { api } from '#/api/request';

export async function getList(params: {
  page: number;
  pageSize: number;
  status?: number;
  username?: string;
  userType?: number;
}) {
  return api.get('/LoginLog/List', { params });
}
