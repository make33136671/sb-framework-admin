<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { computed } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Image, Tag, Space, Button } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getList, postDel, getRoleList } from './api';
import { usePermission } from '#/composables/usePermission';

const router = useRouter();

// 权限控制
const { hasPermission, isSuperAdmin } = usePermission();

// 按钮权限
const canAdd = computed(() => hasPermission('admin:add'));
const canEdit = computed(() => hasPermission('admin:edit'));
const canDelete = computed(() => hasPermission('admin:delete'));

interface RowType {
  // productName: string;
  // releaseDate: string;
}

const formOptions: VbenFormProps = {
  schema: [
    {
      label: '用户名',
      fieldName: 'username',
      component: 'Input',
      componentProps: { placeholder: '请输入用户名' },
    },
    {
      label: '名称',
      fieldName: 'name',
      component: 'Input',
      componentProps: { placeholder: '请输入名称' },
    },
    {
      label: '角色',
      fieldName: 'roleId',
      component: 'ApiSelect',

      componentProps: {
        placeholder: '请选择角色',
        api: getRoleList,

        afterFetch: (data: { name: string; id: number }[]) => {
          return data.items.map((item: any) => ({
            label: item.name,
            value: item.id,
          }));
        },
      },

      allowClear: true,
      filterOption: true,
      showSearch: true,
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
    { field: 'username', title: '用户信息',  slots: { default: 'userInfo' } },
    {
      field: 'role',
      title: '角色',
      width: 120,
    },
    {
      field: 'status',
      title: '状态',
      slots: { default: 'status' },
      width: 80,
    },
    {
      field: 'createdTime',
      title: '创建/在线时间',
      width: 200,
      slots: { default: 'createdTime' },
    },
    {
      field: 'authenticatorBindTime',
      title: '绑定谷歌验证器',
      slots: { default: 'authenticatorBindTime' },
      width: 130,
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
        return await getList({
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
 * 新增管理员
 */
const handleAdd = () => {
  router.push({
    name: 'AdminEdit',
  });
};

/**
 * 删除管理员
 * @param id 管理员Id
 */
const delAdmin = (id: number) => {
  postDel(id).then(() => gridApi.query());
};
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-tools>
        <Space>
          <Button @click="router.push({ name: 'LoginLog' })">
            登录日志
          </Button>
          <Button v-if="canAdd" type="primary" @click="handleAdd">
            新增管理员
          </Button>
        </Space>
      </template>

      <template #status="{ row }">
        <Tag color="success" v-if="row.status == 0"> 正常 </Tag>
        <Tag color="error" v-if="row.status == 1"> 停用 </Tag>
      </template>

      <template #userInfo="{ row }">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <Image
            :src="row.avatar"
            :style="{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              objectFit: 'cover',
            }"
            :preview="{ mask: '查看' }"
          />
          <div style="text-align: center; font-size: 13px;">
            <div style="font-weight: 500;">{{ row.username }}</div>
            <div style="color: #999; font-size: 12px;">{{ row.name }}</div>
          </div>
        </div>
      </template>

      <template #createdTime="{ row }">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div>
            <span style="color: #999; font-size: 12px;"></span>
            {{ row.createdTime ? new Date(row.createdTime).toLocaleString('zh-CN') : '-' }}
          </div>
          <div>
            <span style="color: #999; font-size: 12px;"></span>
            {{ row.lastOnlineTime ? new Date(row.lastOnlineTime).toLocaleString('zh-CN') : '未登录' }}
          </div>
        </div>
      </template>

      <template #authenticatorBindTime="{ row }">
        <Tag v-if="row.authenticatorBindTime" color="success"> 已绑定 </Tag>
        <Tag v-else color="error"> 未绑定 </Tag>
      </template>

      <template #action="{ row }">
        <Space>
          <Button v-if="canEdit" type="primary" @click="
            router.push({
              name: 'AdminEdit',
              query: { id: row.id },
              params: { id: row.id },
            })
            ">
            编辑
          </Button>

          <Button v-if="canDelete && row.id != 1" type="primary" danger @click="delAdmin(row.id)">
            删除
          </Button>
        </Space>
      </template>
    </Grid>
  </Page>
</template>
