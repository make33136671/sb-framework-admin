<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { Card } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { getAdminTypeOptions } from '#/types/admin';

import {
  getDetail,
  getParentList,
  getRoleList,
  postAdd,
  postEdit,
} from './api';

const route = useRoute();

const id = ref<number>(0);

onMounted(async () => {
  const queryId = Number(route.query.id ?? 0);
  id.value = Number.isNaN(queryId) ? 0 : queryId;
  if (id.value > 0) {
    getDetail(id.value).then((result) => {
      baseFormApi.setValues(result);
    });
  }
});

const [BaseForm, baseFormApi] = useVbenForm({
  commonConfig: {
    colon: true,
    componentProps: {
      class: 'w-full',
    },
  },
  fieldMappingTime: [['rangePicker', ['startTime', 'endTime'], 'YYYY-MM-DD']],
  handleSubmit: onSubmit,

  layout: 'horizontal',
  schema: [
    {
      fieldName: 'adminType',
      component: 'Select',
      label: '角色类型',
      rules: 'required',
      defaultValue: 3,
      componentProps: {
        placeholder: '请选择角色类型',
        options: getAdminTypeOptions(),
      },
    },
    {
      fieldName: 'parentId',
      component: 'ApiSelect',
      label: '上级管理员',
      dependencies: {
        triggerFields: ['adminType'],
        show: (values) => {
          // 只有客服(3)需要选择上级站长
          return values.adminType === 3;
        },
        rules: (values) => {
          // 客服时必填
          return values.adminType === 3 ? 'required' : '';
        },
      },
      componentProps: {
        placeholder: '请选择上级管理员',
        api: getParentList,
        afterFetch: (data: any) => {
          return data.items.map((item: any) => ({
            label: `${item.name} (${item.username})`,
            value: item.id,
          }));
        },
      },
    },
    {
      fieldName: 'roleId',
      component: 'ApiSelect',
      label: '角色',
      rules: 'required',
      componentProps: {
        placeholder: '请选择角色',
        afterFetch: (data: { items: { id: number; name: string; }[] }) => {
          if (id.value == undefined || id.value <= 0) {
            baseFormApi.setValues({ roleId: data.items[0]?.id });
          }
          return data.items.map((item: any) => ({
            label: item.name,
            value: item.id,
          }));
        },
        api: getRoleList,
      },
    },
    {
      fieldName: 'username',
      component: 'Input',
      label: '用户名',
      rules: 'required',
      componentProps: { placeholder: '请输入管理员用户名' },
    },
    {
      fieldName: 'password',
      component: 'Input',
      label: '密码',
      rules: 'required',
      componentProps: { placeholder: '请输入管理员密码' },
    },
    {
      fieldName: 'name',
      component: 'Input',
      label: '名称',
      componentProps: { placeholder: '请输入管理员名称' },
    },
    {
      fieldName: 'nickname',
      component: 'Input',
      label: '昵称',
      componentProps: { placeholder: '请输入管理员昵称' },
    },
    {
      fieldName: 'status',
      component: 'RadioGroup',
      label: '状态',
      defaultValue: 0,
      componentProps: {
        options: [
          { label: '正常', value: 0, key: '0' },
          { label: '停用', value: 1, key: '1' },
        ],
      },
    },
  ],
  wrapperClass: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
});

function onSubmit(values: Record<string, any>) {
  if (id.value > 0) {
    values.id = id.value;
    postEdit(values);
  } else {
    postAdd(values).then((data: any) => {
      id.value = data.id;
    });
  }
}
</script>

<template>
  <Card title="管理员" style="margin: 10px">
    <BaseForm />
  </Card>
</template>
