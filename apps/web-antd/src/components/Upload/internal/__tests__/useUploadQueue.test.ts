import type { UploadItem } from '../types';

import { nextTick, ref } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { useUploadQueue } from '../useUploadQueue';

function makeItem(uid: string): UploadItem {
  return {
    uid,
    status: 'queued',
    progress: 0,
    name: `${uid}.txt`,
  };
}

describe('useUploadQueue', () => {
  it('同时只有一个 uploading，其它保持 queued', async () => {
    const items = ref<UploadItem[]>([
      makeItem('a'),
      makeItem('b'),
      makeItem('c'),
    ]);
    const runUpload = vi.fn(async (item: UploadItem) => {
      item.status = 'uploading';
      await new Promise((r) => setTimeout(r, 30));
    });

    useUploadQueue(items, runUpload);
    await nextTick();
    await new Promise((r) => setTimeout(r, 5));

    const uploading = items.value.filter((i) => i.status === 'uploading');
    expect(uploading.length).toBe(1);
  });

  it('第一个完成后第二个自动开始', async () => {
    const items = ref<UploadItem[]>([makeItem('a'), makeItem('b')]);
    const runUpload = vi.fn(async (item: UploadItem) => {
      item.status = 'uploading';
      await new Promise((r) => setTimeout(r, 20));
      item.status = 'done';
    });

    useUploadQueue(items, runUpload);
    await new Promise((r) => setTimeout(r, 80));

    expect(items.value[0]!.status).toBe('done');
    expect(items.value[1]!.status).toBe('done');
  });

  it('一个失败不影响后续', async () => {
    const items = ref<UploadItem[]>([makeItem('a'), makeItem('b')]);
    const runUpload = vi.fn(async (item: UploadItem) => {
      item.status = 'uploading';
      await new Promise((r) => setTimeout(r, 20));
      if (item.uid === 'a') {
        item.status = 'error';
        item.error = 'mocked';
      } else {
        item.status = 'done';
      }
    });

    useUploadQueue(items, runUpload);
    await new Promise((r) => setTimeout(r, 80));

    expect(items.value[0]!.status).toBe('error');
    expect(items.value[1]!.status).toBe('done');
  });

  it('动态新加入的 queued 项被消费', async () => {
    const items = ref<UploadItem[]>([]);
    const runUpload = vi.fn(async (item: UploadItem) => {
      item.status = 'uploading';
      await new Promise((r) => setTimeout(r, 10));
      item.status = 'done';
    });

    useUploadQueue(items, runUpload);
    items.value.push(makeItem('a'));
    await new Promise((r) => setTimeout(r, 40));
    expect(items.value[0]!.status).toBe('done');
  });
});
