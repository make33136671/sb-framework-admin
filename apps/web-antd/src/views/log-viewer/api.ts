import { useAppConfig } from '@vben/hooks';
import { useAccessStore } from '@vben/stores';

import { api } from '#/api/request';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

export async function getFiles() {
  return api.get('/LogViewer/Files');
}

export async function readFile(fileName: string, tail = 500, archive?: string) {
  return api.get('/LogViewer/Read', {
    params: { fileName, tail, ...(archive ? { archive } : {}) },
  });
}

export function downloadFile(fileName: string, archive?: string) {
  const accessStore = useAccessStore();
  const archiveParam = archive ? `&archive=${encodeURIComponent(archive)}` : '';
  fetch(
    `${apiURL}/LogViewer/Download?fileName=${encodeURIComponent(fileName)}${archiveParam}`,
    {
      headers: { Authorization: `Bearer ${accessStore.accessToken}` },
    },
  )
    .then((res) => {
      if (!res.ok) throw new Error('下载失败');
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
    });
}
