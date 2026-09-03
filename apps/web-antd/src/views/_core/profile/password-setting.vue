<script setup lang="ts">
import type { Recordable } from '@vben/types';

import type { VbenFormSchema } from '#/adapter/form';

import { computed, ref } from 'vue';

import { ProfilePasswordSetting, z } from '@vben/common-ui';

import { changePasswordApi } from '#/api/core/admin';

const profilePasswordSettingRef = ref();

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      fieldName: 'oldPassword',
      label: '旧密码',
      component: 'VbenInputPassword',
      componentProps: {
        placeholder: '请输入旧密码',
      },
      rules: z
        .string({ required_error: '请输入旧密码' })
        .min(1, { message: '请输入旧密码' }),
    },
    {
      fieldName: 'newPassword',
      label: '新密码',
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: '请输入新密码',
      },
      rules: z
        .string({ required_error: '请输入新密码' })
        .min(6, { message: '密码长度不能少于6位' }),
    },
    {
      fieldName: 'confirmPassword',
      label: '确认密码',
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: '请再次输入新密码',
      },
      dependencies: {
        rules(values) {
          const { newPassword } = values;
          return z
            .string({ required_error: '请再次输入新密码' })
            .min(1, { message: '请再次输入新密码' })
            .refine((value) => value === newPassword, {
              message: '两次输入的密码不一致',
            });
        },
        triggerFields: ['newPassword'],
      },
    },
  ];
});

async function handleSubmit(values: Recordable<any>) {
  const { oldPassword, newPassword } = values as {
    newPassword?: string;
    oldPassword?: string;
  };
  if (!oldPassword || !newPassword) {
    return;
  }
  try {
    const res = await changePasswordApi({
      oldPassword,
      newPassword,
    });
    // sbRequestClient 会自动显示成功/失败消息
    if (res?.code === 0) {
      // 清空表单
      profilePasswordSettingRef.value?.getFormApi?.()?.resetForm?.();
    }
  } catch {
    // sbRequestClient 会自动处理错误消息
  }
}
</script>
<template>
  <div class="flex justify-center w-full">
    <ProfilePasswordSetting
      ref="profilePasswordSettingRef"
      class="w-full max-w-md"
      :form-schema="formSchema"
      @submit="handleSubmit"
    />
  </div>
</template>
