<script lang="ts" setup>
import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';

import { Button, Modal, Space, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getList, postDel } from './api';
// import { VbenIcon } from '@vben-core/shadcn-ui';
import TreeView from './Tree.vue';

const router = useRouter();

interface RowType {
  hideInMenu?: boolean;
  icon?: string;
  id: number;
  ignoreKeepAlive?: boolean;
}

const formOptions: VbenFormProps = {
  schema: [
    {
      label: '名称',
      fieldName: 'name',
      component: 'Input',
      componentProps: { placeholder: '请输入名称' },
    },
    {
      label: '显示标题',
      fieldName: 'title',
      component: 'Input',
      componentProps: { placeholder: '请输入显示标题' },
    },
  ],
  wrapperClass: 'grid-cols-2',
  // 控制表单是否显示折叠按钮
  showCollapseButton: false,
  // 是否在字段值改变时提交表单
  submitOnChange: false,
  // 按下回车时是否提交表单
  submitOnEnter: true,
};

const gridOptions: VxeGridProps<RowType> = {
  columns: [
    // { fixed: 'left', field: 'id', title: 'Id', width: 50 },
    //  { field: 'parentId', title: '父级Id', sortable: true, },
    { field: 'title', title: '显示标题' },
    { field: 'icon', title: '图标', slots: { default: 'icon' }, width: 220 },
    { field: 'name', title: '名称' },
    { field: 'component', title: '组件路径' },
    { field: 'path', title: '路由路径' },
    { field: 'redirect', title: '重定向路由' },
    { field: 'orderNo', title: '排序编号', sortable: true },
    {
      field: 'hideInMenu',
      title: '隐藏菜单',
      slots: { default: 'hideInMenu' },
    },
    {
      field: 'ignoreKeepAlive',
      title: '忽略保持存活',
      slots: { default: 'ignoreKeepAlive' },
    },

    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'action' },
      title: '操作',
      width: 170,
    },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        const menuData = await getList({
          ...formValues,
          page: page?.currentPage,
          pageSize: page?.pageSize,
        });
        return menuData;
      },
    },
  },
  showOverflow: false,
  rowConfig: {
    isHover: true,
  },
  toolbarConfig: {
    refresh: true,
    custom: true,
  },
};

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

/**
 * 删除权限菜单
 * @param id 权限菜单Id
 */
const delMenu = (id: number) => {
  postDel(id).then(() => gridApi.query());
};

const treeVisible = ref(false);
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-tools>
        <Button @click="treeVisible = true"> 树型视图 </Button>
      </template>
      <template #icon="{ row }">
        <div style="display: flex; align-items: center">
          <div style="flex: 0.2">
            <IconifyIcon :icon="row.icon ?? ''" style="font-size: 24px" />
          </div>
          <div style="flex: 1; text-align: left">
            {{ row.icon }}
          </div>
        </div>
      </template>

      <template #hideInMenu="{ row }">
        <Tag color="error" v-if="row.hideInMenu"> 隐藏 </Tag>

        <Tag color="success" v-else> 显示 </Tag>
      </template>

      <template #ignoreKeepAlive="{ row }">
        <Tag color="success" v-if="row.ignoreKeepAlive"> 存活 </Tag>

        <Tag color="error" v-else> 销毁 </Tag>
      </template>

      <template #action="{ row }">
        <Space>
          <Button
            type="primary"
            @click="
              router.push({
                name: 'MenuEdit',
                query: { id: row.id },
                params: { id: row.id },
              })
            "
          >
            编辑
          </Button>

          <Button type="primary" @click="delMenu(row.id)"> 删除 </Button>
        </Space>
      </template>
    </Grid>

    <Modal
      v-model:open="treeVisible"
      title="菜单树"
      width="90%"
      :footer="null"
      :body-style="{ padding: 0, height: '70vh' }"
      destroy-on-close
    >
      <TreeView v-if="treeVisible" @success="gridApi.query()" />
    </Modal>
  </Page>
</template>
