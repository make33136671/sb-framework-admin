<script setup lang="ts">
import type { VbenFormSchema } from '#/adapter/form';

import { computed, onMounted, ref } from 'vue';

import { ProfileBaseSetting } from '@vben/common-ui';

import { getUserInfoApi } from '#/api';

const profileBaseSettingRef = ref();

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      fieldName: 'Username',
      component: 'Input',
      label: '用户名',
      componentProps: {
        disabled: true,
      },
    },
    {
      fieldName: 'Name',
      component: 'Input',
      label: '姓名',
      componentProps: {
        disabled: true,
      },
    },
    {
      fieldName: 'RoleKey',
      component: 'Input',
      label: '角色',
      componentProps: {
        disabled: true,
      },
    },
  ];
});

onMounted(async () => {
  const data = await getUserInfoApi();
  profileBaseSettingRef.value.getFormApi().setValues(data);
});
</script>
<template>
  <ProfileBaseSetting ref="profileBaseSettingRef" :form-schema="formSchema" />
</template>
