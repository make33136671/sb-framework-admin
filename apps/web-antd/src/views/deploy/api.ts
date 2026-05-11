import { api } from '#/api/request';

export async function getInfo(options?: { silent?: boolean }) {
  return api.get('/App/Info', options);
}

export async function postRestart() {
  return api.post('/App/Restart', {}, { silent: true });
}

export async function postUploadApi(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/App/UploadApi', formData, { silent: true });
}

export async function getDeployTargets() {
  return api.get('/App/DeployTargets');
}

export async function postUploadProject(key: string, file: File) {
  const formData = new FormData();
  formData.append('key', key);
  formData.append('file', file);
  return api.post('/App/UploadProject', formData);
}

export async function getPreviewDeploy(
  target: string,
  filePath: string,
  fileName?: string,
) {
  return api.get('/App/PreviewDeploy', {
    params: { target, filePath, fileName },
  });
}

export async function postCancelUpload(filePath: string) {
  const formData = new FormData();
  formData.append('filePath', filePath);
  return api.post('/App/CancelUpload', formData, { silent: true });
}

export async function postDeployApiByPath(
  filePath: string,
  fileName: string,
  fileSize: number,
  clearCache = false,
) {
  const formData = new FormData();
  formData.append('filePath', filePath);
  formData.append('fileName', fileName);
  formData.append('fileSize', String(fileSize));
  formData.append('clearCache', String(clearCache));
  return api.post('/App/DeployApiByPath', formData, { silent: true });
}

export async function postDeployProjectByPath(key: string, filePath: string, fileName: string, fileSize: number) {
  const formData = new FormData();
  formData.append('key', key);
  formData.append('filePath', filePath);
  formData.append('fileName', fileName);
  formData.append('fileSize', String(fileSize));
  return api.post('/App/DeployProjectByPath', formData);
}

export async function getDeployRecords(params: { target?: string; page?: number; pageSize?: number }) {
  return api.get('/App/DeployRecords', { params });
}

export async function postRollback(id: number) {
  const formData = new FormData();
  formData.append('id', String(id));
  return api.post('/App/Rollback', formData);
}
