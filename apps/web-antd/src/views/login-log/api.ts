import { api } from '#/api/request';

export async function getList(params: {
  userType?: number;
  username?: string;
  status?: number;
  page: number;
  pageSize: number;
}) {
  return api.get('/LoginLog/List', { params });
}
