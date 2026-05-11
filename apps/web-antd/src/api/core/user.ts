import type { UserInfo } from '@vben/types';

import { api } from '#/api/request';

export async function getUserInfoApi() {
  return api.get<UserInfo>('/Auth/GetInfo');
}
