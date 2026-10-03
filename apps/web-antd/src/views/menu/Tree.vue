<script lang="ts" setup>
import type { VxeTableGridOptions } from '#/adapter/vxe-table';

import { useVbenDrawer } from '@vben/common-ui';
import { IconifyIcon, Plus } from '@vben/icons';
import { $t } from '@vben/locales';

import { Button, Popconfirm, Space, Switch } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getMenuTreeList, postDel, updateMenu } from './api';
import Form from './Form.vue';

const emit = defineEmits<{ success: [] }>();

const [FormDrawer, formDrawerApi] = useVbenDrawer({
  connectedComponent: Form,
  destroyOnClose: true,
});

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: [
      {
        align: 'left',
        field: 'meta.title',
        fixed: 'left',
        slots: { default: 'title' },
        title: $t('system.menu.menuTitle'),
        treeNode: true,
        width: 250,
      },
      {
        align: 'center',
        field: 'name',
        title: $t('system.menu.name'),
        width: 200,
      },
      {
        align: 'left',
        field: 'path',
        slots: { default: 'pathComponent' },
        title: '路由路径 / 组件路径 / 重定向',
        minWidth: 300,
      },
      {
        align: 'left',
        field: 'meta.orderNo',
        title: $t('system.menu.orderNo'),
        width: 100,
      },
      {
        align: 'center',
        field: 'meta.hideInMenu',
        slots: { default: 'hideInMenu' },
        title: $t('system.menu.hideInMenu'),
        width: 100,
      },
      {
        align: 'center',
        field: 'meta.ignoreKeepAlive',
        slots: { default: 'ignoreKeepAlive' },
        title: $t('system.menu.ignoreKeepAlive'),
        width: 100,
      },
      {
        align: 'center',
        field: 'action',
        fixed: 'right',
        slots: { default: 'action' },
        title: $t('common.action'),
        width: 170,
      },
    ],
    height: 'auto',
    keepSource: true,
    pagerConfig: {
      enabled: false,
    },
    proxyConfig: {
      ajax: {
        query: async (_params) => {
          return await getMenuTreeList();
        },
      },
    },
    rowConfig: {
      keyField: 'id',
      height: 80,
    },
    toolbarConfig: {
      custom: true,
      export: false,
      refresh: true,
      zoom: true,
    },
    treeConfig: {
      parentField: 'parentId',
      rowField: 'id',
      transform: false,
    },
  } as VxeTableGridOptions,
});

function onRefresh() {
  gridApi.query();
  emit('success');
}

function onCreate() {
  formDrawerApi.setData({}).open();
}

async function onSwitchChange(
  row: any,
  field: 'hideInMenu' | 'ignoreKeepAlive',
  value: boolean | number | string,
) {
  // toast 由 axios 拦截器统一弹
  await updateMenu(row.id, field, value);
  onRefresh();
}

function onEdit(row: any) {
  formDrawerApi.setData(row).open();
}

async function onDelete(row: any) {
  // toast 由 axios 拦截器统一弹
  await postDel(row.id);
  onRefresh();
}
</script>
<template>
  <div style="height: 100%">
    <FormDrawer @success="onRefresh" />
    <Grid>
      <template #toolbar-tools>
        <Button type="primary" @click="onCreate">
          <Plus class="size-5" />
          {{ $t('ui.actionTitle.create', [$t('system.menu.menu')]) }}
        </Button>
      </template>
      <template #title="{ row }">
        <div class="flex w-full items-center gap-1">
          <div class="size-5 flex-shrink-0">
            <IconifyIcon
              :icon="row.meta?.icon || 'carbon:circle-dash'"
              class="size-full"
            />
          </div>
          <span class="flex-auto">{{ row.meta?.title }}</span>
          <div class="items-center justify-end"></div>
        </div>
      </template>
      <template #pathComponent="{ row }">
        <div class="flex flex-col gap-1">
          <div v-if="row.path" class="text-sm">
            <span class="text-gray-500">路由:</span> {{ row.path }}
          </div>
          <div v-if="row.component" class="text-sm">
            <span class="text-gray-500">组件:</span> {{ row.component }}
          </div>
          <div v-if="row.redirect" class="text-sm">
            <span class="text-gray-500">重定向:</span> {{ row.redirect }}
          </div>
        </div>
      </template>
      <template #hideInMenu="{ row }">
        <Switch
          :checked="row.meta?.hideInMenu === true || row.meta?.hideInMenu === 1"
          @change="onSwitchChange(row, 'hideInMenu', $event)"
        />
      </template>
      <template #ignoreKeepAlive="{ row }">
        <Switch
          :checked="
            row.meta?.ignoreKeepAlive === true ||
            row.meta?.ignoreKeepAlive === 1
          "
          @change="onSwitchChange(row, 'ignoreKeepAlive', $event)"
        />
      </template>
      <template #action="{ row }">
        <Space style="justify-content: space-around; width: 100%">
          <Button type="primary" @click="onEdit(row)" style="flex: 1">
            {{ $t('common.edit') }}
          </Button>
          <Popconfirm title="确定删除该菜单吗？" @confirm="onDelete(row)">
            <Button danger style="flex: 1">
              {{ $t('common.delete') }}
            </Button>
          </Popconfirm>
        </Space>
      </template>
    </Grid>
  </div>
</template>
<style lang="scss" scoped></style>
