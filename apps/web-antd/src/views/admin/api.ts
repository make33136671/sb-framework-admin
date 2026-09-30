import { api } from '#/api/request';

export async function getList(params: any) {
  return api.get('/Manager/List', { params });
}

export async function getDetail(id: number) {
  return api.get('/Manager/Detail', { params: { id } });
}

export async function postAdd(data: any) {
  return api.post('/Manager/Add', data);
}

export async function postEdit(params: any) {
  return params.id ? api.post('/Manager/Edit', params) : postAdd(params);
}

export async function postDel(id: any) {
  return api.post('/Manager/Del', { id });
}

export async function getRoleList(params: any) {
  return api.get('/Manager/RoleList', { params });
}

export async function getRoleDetail(id: number) {
  return api.get('/Manager/RoleDetail', { params: { id } });
}

export async function postRoleAdd(data: any) {
  return api.post('/Manager/RoleAdd', data);
}

export async function postRoleEdit(params: any) {
  return params.id
    ? api.post('/Manager/RoleEdit', params)
    : postRoleAdd(params);
}

export async function postRoleDel(id: any) {
  return api.post('/Manager/RoleDel', { id });
}

export async function getParentList() {
  return api.get('/Manager/List', { params: { page: 1, pageSize: 1000 } });
}

export async function getAllMenuTree() {
  return api.get('/Menu/TreeList', { params: { page: 1, pageSize: 1000 } });
}

export async function getRoleMenuIds(roleId: number) {
  return api.get('/Manager/GetMenuIds', { params: { roleId } });
}

export async function setRoleMenus(roleId: number, menuIds: number[]) {
  return api.post('/Manager/SetMenus', {
    roleId,
    menuIds: menuIds.join(','),
  });
}

export async function resetGoogleCode(adminId: number) {
  return api.post('/Manager/ResetGoogleCode', { adminId });
}

export async function getRoleMenusDetail(roleId: number) {
  return api.get('/Manager/GetMenusDetail', { params: { roleId } });
}

export async function addRoleMenu(roleId: number, menuId: number) {
  return api.post('/Manager/AddMenu', { roleId, menuId });
}

export async function removeRoleMenu(roleId: number, menuId: number) {
  return api.post('/Manager/RemoveMenu', { roleId, menuId });
}

export async function copyRoleMenus(fromRoleId: number, toRoleId: number) {
  return api.post('/Manager/CopyMenus', { fromRoleId, toRoleId });
}

export async function getRolesByMenu(menuId: number) {
  return api.get('/Manager/GetRolesByMenu', { params: { menuId } });
}

export async function queryAdminRole(key: string) {
  return api.get('/Manager/QueryAdminRole', { params: { key } });
}
