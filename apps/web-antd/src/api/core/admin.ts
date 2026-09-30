import type { UserInfo } from '@vben/types';

import { api } from '#/api/request';

/** 兼容旧业务 import { uploadFileApi } from '#/api/core/admin' */

export namespace AdminApi {
  export interface LoginParams {
    password?: string;
    username?: string;
    totpCode?: string;
  }

  export interface LoginResult {
    accessToken: string;
    userInfo?: UserInfo;
  }

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

export async function loginApi(data: AdminApi.LoginParams) {
  return api.post<AdminApi.LoginResult>('/Auth/Login', data, { quiet: true });
}

export async function getAdminInfoApi() {
  return api.get<UserInfo>('/Auth/GetInfo');
}

export async function refreshTokenApi() {
  return api.raw.post<AdminApi.RefreshTokenResult>('/Auth/Login', {
    withCredentials: true,
  });
}

export async function logoutApi() {
  return api.raw.post('/Auth/Logout', { withCredentials: true });
}

export async function getAccessCodesApi() {
  return api.get<string[]>('/auth/codes');
}

export async function changePasswordApi(data: {
  newPassword: string;
  oldPassword: string;
}) {
  return api.post('/Auth/ChangePassword', data);
}

export async function changeAvatarApi(avatar: string) {
  return api.post('/Auth/ChangeAvatar', { avatar });
}

export async function updateProfileApi(data: {
  name: string;
  nickname: string;
}) {
  return api.post('/Auth/UpdateProfile', data);
}

export async function getGoogleCodeInfoApi() {
  return api.get('/Auth/GetGoogleCodeInfo');
}

export async function getGoogleCodeQRApi() {
  return api.get('/Auth/GetGoogleCodeQR');
}

export async function bindGoogleCodeApi(googleCode: string, password: string) {
  return api.post('/Auth/PostBindGoogleCode', {
    code: googleCode,
    password,
  });
}

export async function unbindGoogleCodeApi(totpCode: string, password: string) {
  return api.post('/Auth/UnbindGoogleCode', { totpCode, password });
}

export { directUploadApi as uploadFileApi } from '#/api/core/upload';
