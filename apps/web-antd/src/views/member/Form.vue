<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { Card } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';

import { getDetail, postAdd, postEdit } from './api';

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
  handleSubmit: onSubmit,

  layout: 'horizontal',
  schema: [
    {
      fieldName: 'username',
      component: 'Input',
      label: '用户名',
      rules: 'required',
      componentProps: { placeholder: '请输入用户名' },
    },
    {
      fieldName: 'password',
      component: 'Input',
      label: '密码',
      componentProps: { placeholder: '请输入密码', type: 'password' },
      dependencies: {
        triggerFields: [],
        if: () => id.value === 0,
      },
    },
    {
      fieldName: 'name',
      component: 'Input',
      label: '名称',
      componentProps: { placeholder: '请输入名称' },
    },
    {
      fieldName: 'avatar',
      component: 'Input',
      label: '头像',
      componentProps: { placeholder: '请输入头像URL' },
    },
    {
      fieldName: 'status',
      component: 'RadioGroup',
      label: '账户状态',
      defaultValue: 0,
      componentProps: {
        options: [
          { label: '正常', value: 0, key: '0' },
          { label: '封禁', value: 1, key: '1' },
        ],
      },
    },
    {
      fieldName: 'creditScore',
      component: 'InputNumber',
      label: '信用分',
      defaultValue: 100,
      componentProps: { placeholder: '信用分', min: 0, max: 999 },
    },
    {
      fieldName: 'realNameStatus',
      component: 'RadioGroup',
      label: '实名认证',
      defaultValue: 0,
      componentProps: {
        options: [
          { label: '未认证', value: 0, key: '0' },
          { label: '审核中', value: 1, key: '1' },
          { label: '已认证', value: 2, key: '2' },
          { label: '已拒绝', value: 3, key: '3' },
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
  <Card title="会员" style="margin: 10px">
    <BaseForm />
  </Card>
</template>
