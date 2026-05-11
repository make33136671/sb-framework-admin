import { api } from '#/api/request';

export async function getCacheInfo() {
  return api.get('/App/CacheInfo');
}

export async function postClearAllCache() {
  return api.post('/App/ClearAllCache', {});
}

export async function postClearCacheByPrefix(prefix: string) {
  return api.post('/App/ClearCacheByPrefix', { prefix });
}
