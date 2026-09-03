import { useAppConfig } from '@vben/hooks';
import { useAccessStore } from '@vben/stores';

import { api } from '#/api/request';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

export async function executeSql(sql: string) {
  return api.post('/Sql/Execute', { sql }, { quiet: true });
}

/** 导出 CSV（通过 fetch 下载） */
export function exportCsv(sql: string) {
  const accessStore = useAccessStore();
  const body = new URLSearchParams();
  body.append('sql', sql);

  fetch(`${apiURL}/Sql/ExportCsv`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessStore.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body,
  })
    .then((res) => {
      if (!res.ok) throw new Error('导出失败');
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename=(.+)/);
      const fileName = match?.[1] ?? `query_${Date.now()}.csv`;
      return res.blob().then((blob) => ({ blob, fileName }));
    })
    .then(({ blob, fileName }) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
    });
}
