<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Image,
  Tag,
  Space,
  Button,
  CheckboxGroup,
  Form,
  FormItem,
  Input,
  message,
  Radio,
  RadioGroup,
  Select,
  Switch,
  TabPane,
  Tabs,
  Textarea,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getRoleList, postRoleDel } from './api';

const router = useRouter();

interface RowType {
  // productName: string;
  // releaseDate: string;
}

const formOptions: VbenFormProps = {
  schema: [
    {
      label: '角色名称',
      fieldName: 'name',
      component: 'Input',
      componentProps: { placeholder: '请输入角色名称' },
    },
    {
      label: '角色Key',
      fieldName: 'roleKey',
      component: 'Input',
      componentProps: { placeholder: '请输入角色Key' },
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
    { fixed: 'left', field: 'id', title: 'Id', width: 50 },
    { field: 'name', title: '角色名称', width: 150 },
    { field: 'roleKey', title: '角色Key', width: 150 },
    {
      field: 'menuCount',
      title: '启用菜单数',
      width: 120,
      slots: { default: 'menuCount' },
    },
    {
      field: 'topMenus',
      title: '可用顶级菜单',
      minWidth: 200,
      slots: { default: 'topMenus' },
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
        return await getRoleList({
          page: page.currentPage,
          pageSize: page.pageSize,
          ...formValues,
        });
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
 * 删除管理员角色
 * @param id 管理员角色Id
 */
const delAdminRole = (id: number) => {
  postRoleDel(id).then(() => gridApi.query());
};
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-tools>
        <Button
          type="primary"
          @click="router.push({ name: 'AdminRoleAdd' })"
        >
          添加角色
        </Button>
      </template>

      <template #menuCount="{ row }">
        <Tag :color="row.menuCount > 0 ? 'blue' : 'default'">
          {{ row.menuCount }} 个
        </Tag>
      </template>

      <template #topMenus="{ row }">
        <span v-if="!row.topMenus || row.topMenus === ''" style="color: #999">
          未配置
        </span>
        <template v-else>
          <Tag
            v-for="(menu, index) in row.topMenus.split(', ')"
            :key="index"
            color="green"
            style="margin-bottom: 4px"
          >
            {{ menu }}
          </Tag>
        </template>
      </template>

      <template #action="{ row }">
        <Space>
          <Button
            type="primary"
            @click="
              router.push({
                name: 'AdminRoleEdit',
                query: { id: row.id },
                params: { id: row.id },
              })
            "
          >
            编辑
          </Button>

          <Button type="primary" @click="delAdminRole(row.id)">
            删除
          </Button>
        </Space>
      </template>
    </Grid>
  </Page>
</template>
