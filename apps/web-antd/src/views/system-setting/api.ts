import { api } from '#/api/request';

export async function getList(params: any) {
  return api.get('/SystemSetting/List', { params });
}

export async function getCategoryWithSettingList() {
  return api.get('/SystemSetting/GetCategoryWithSettingList');
}

export async function getDetail(id: number) {
  return api.get('/SystemSetting/Detail', { params: { id } });
}

export async function postAdd(data: any) {
  return api.post('/SystemSetting/Add', data);
}

export async function postEdit(params: any) {
  return params.id ? api.post('/SystemSetting/Edit', params) : postAdd(params);
}

export async function postSaveList(data: any[]) {
  return api.post('/SystemSetting/SaveList', {
    settings: JSON.stringify(data),
  });
}

export async function postDel(id: any) {
  return api.post('/SystemSetting/Del', { id });
}

// ========== 系统设置分类 ==========

export async function getCategoryList(params: any) {
  return api.get('/SystemSettingCategory/List', { params });
}

export async function getCategoryDetail(id: number) {
  return api.get('/SystemSettingCategory/Detail', { params: { id } });
}

export async function postCategoryAdd(data: any) {
  return api.post('/SystemSettingCategory/Add', data);
}

export async function postCategoryEdit(params: any) {
  return params.id
    ? api.post('/SystemSettingCategory/Edit', params)
    : postCategoryAdd(params);
}

export async function postCategoryDel(id: any) {
  return api.post('/SystemSettingCategory/Del', { id });
}

export async function querySystemSetting(key: string) {
  return api.get('/SystemSetting/QuerySystemSetting', { params: { key } });
}

export async function queryCategoryList(key: string) {
  return api.get('/SystemSettingCategory/QuerySystemSettingCategory', {
    params: { key },
  });
}
