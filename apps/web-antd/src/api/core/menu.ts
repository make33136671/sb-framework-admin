import type { RouteRecordStringComponent } from '@vben/types';

import { api } from '#/api/request';

export async function getAllMenusApi() {
  return api.get<RouteRecordStringComponent[]>('/Menu/All');
}
