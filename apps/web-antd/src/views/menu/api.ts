import type { Recordable } from '@vben/types';

import { api } from '#/api/request';

export namespace SystemMenuApi {
  export const BadgeVariants = [
    'default',
    'destructive',
    'primary',
    'success',
    'warning',
  ] as const;
  export const BadgeTypes = ['dot', 'normal'] as const;
  export const MenuTypes = [
    'catalog',
    'menu',
    'embedded',
    'link',
    'button',
  ] as const;
  export interface SystemMenu {
    [key: string]: any;
    authCode: string;
    children?: SystemMenu[];
    component?: string;
    id: string;
    meta?: {
      activeIcon?: string;
      activePath?: string;
      affixTab?: boolean;
      affixTabOrder?: number;
      badge?: string;
      badgeType?: (typeof BadgeTypes)[number];
      badgeVariants?: (typeof BadgeVariants)[number];
      hideChildrenInMenu?: boolean;
      hideInBreadcrumb?: boolean;
      hideInMenu?: boolean;
      hideInTab?: boolean;
      icon?: string;
      iframeSrc?: string;
      keepAlive?: boolean;
      link?: string;
      maxNumOfOpenTab?: number;
      noBasicLayout?: boolean;
      openInNewWindow?: boolean;
      order?: number;
      query?: Recordable<any>;
      title?: string;
    };
    name: string;
    path: string;
    pid: string;
    redirect?: string;
    type: (typeof MenuTypes)[number];
  }
}

export async function addMenu(data: any) {
  return api.post('/Menu/Add', data);
}

export async function updateMenu(id: any, field: string, value: string) {
  return api.post('/Menu/UpdateMenu', { id, field, value });
}

export async function getMenuTreeList() {
  // 树形视图需返回全部顶级菜单(后端默认 pageSize=10 会截断顶级菜单导致显示不全)
  return api.get('/Menu/TreeList', { params: { page: 1, pageSize: 9999 } });
}

export async function getMenuList() {
  return api.get<Array<SystemMenuApi.SystemMenu>>('/Menu/All');
}

export async function getList(params: any) {
  return api.get('/Menu/List', { params });
}

export async function getDetail(id: number) {
  return api.get('/Menu/Detail', { params: { id } });
}

export async function postAdd(data: any) {
  return api.post('/Menu/Add', data);
}

export async function postEdit(params: any) {
  const hasId = params instanceof FormData ? params.has('id') : !!params.id;
  if (hasId) {
    return api.post('/Menu/Edit', params);
  } else {
    return postAdd(params);
  }
}

export async function postDel(id: any) {
  return api.post('/Menu/Del', { id });
}

export async function queryMenu(key: string) {
  return api.get('/Menu/QueryMenu', { params: { key } });
}
