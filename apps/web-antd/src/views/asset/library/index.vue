<script lang="ts" setup>
/**
 * 素材库（契约 §5.1 Asset/LibraryList）：已通过审核并入库的素材复用池。
 */
import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

import { Page } from '@vben/common-ui';

import { Image, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { assetLibraryList } from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';

const formOptions: VbenFormProps = {
  schema: [
    {
      component: 'Input',
      componentProps: { placeholder: 'Key / 标签' },
      fieldName: 'keyword',
      label: '关键词',
    },
    {
      component: 'Select',
      componentProps: {
        options: [
          { label: '角色', value: 'character' },
          { label: '场景', value: 'scene' },
          { label: '道具', value: 'prop' },
        ],
      },
      fieldName: 'kind',
      label: '种类',
    },
  ],
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
  wrapperClass: 'grid-cols-2',
};

interface Row {
  createdAt: string;
  filePath: string;
  id: number;
  key: string;
  kind: string;
  sourceCandidateId: number;
  tags?: string;
}

const gridOptions: VxeGridProps<Row> = {
  columns: [
    { field: 'id', title: 'Id', visible: false, width: 60 },
    {
      field: 'filePath',
      slots: { default: 'preview' },
      title: '预览',
      width: 110,
    },
    { field: 'key', title: 'Key', width: 200 },
    { field: 'kind', slots: { default: 'kind' }, title: '种类', width: 90 },
    { field: 'tags', title: '标签', minWidth: 140 },
    {
      field: 'createdAt',
      slots: { default: 'createdAt' },
      title: '入库时间',
      width: 170,
    },
  ],
  pagerConfig: { enabled: true },
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        const res = await assetLibraryList({
          keyword: formValues.keyword,
          kind: formValues.kind,
          page: page.currentPage,
          pageSize: page.pageSize,
        });
        return { items: res.items, total: res.total };
      },
    },
  },
  toolbarConfig: { custom: true, refresh: true, zoom: true },
};

const [Grid] = useVbenVxeGrid({ formOptions, gridOptions });

/** 绝对路径 → /storage 可访问 URL */
function toStorageUrl(abs?: string): string {
  if (!abs) return '';
  const i = abs.indexOf('/media/');
  return i === -1 ? '' : `/storage${abs.slice(i)}`;
}
</script>

<template>
  <Page title="素材库" description="审核通过并入库的角色 / 场景 / 道具素材">
    <Grid>
      <template #preview="{ row }">
        <Image
          :src="toStorageUrl(row.filePath)"
          :width="72"
          :height="72"
          class="rounded object-cover"
        />
      </template>
      <template #kind="{ row }">
        <Tag
          :color="
            row.kind === 'character'
              ? 'blue'
              : row.kind === 'scene'
                ? 'green'
                : 'orange'
          "
          class="!mr-0"
        >
          {{
            row.kind === 'character'
              ? '角色'
              : row.kind === 'scene'
                ? '场景'
                : '道具'
          }}
        </Tag>
      </template>
      <template #createdAt="{ row }">
        <TimeTag :time="row.createdAt" />
      </template>
    </Grid>
  </Page>
</template>
