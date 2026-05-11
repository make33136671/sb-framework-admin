import { api } from '#/api/request';

export async function getList() {
  return api.get('/BackgroundTask/List');
}

export async function postStart(name: string) {
  return api.post('/BackgroundTask/Start', { name });
}

export async function postStop(name: string) {
  return api.post('/BackgroundTask/Stop', { name });
}

export async function postRestart(name: string) {
  return api.post('/BackgroundTask/Restart', { name });
}

export async function postReloadParameters(name: string) {
  return api.post('/BackgroundTask/ReloadParameters', { name });
}

export async function postRunOnce(name: string) {
  return api.post('/BackgroundTask/RunOnce', { name });
}

export async function getLogs(name: string, limit: number = 100) {
  return api.get('/BackgroundTask/GetLogs', { params: { name, limit } });
}

export async function getLogList(params: {
  source?: number;
  taskName?: string;
  logLevel?: number;
  page: number;
  pageSize: number;
}) {
  return api.get('/BackgroundTask/LogList', { params });
}
