<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { Card } from 'ant-design-vue';
import { useVbenForm } from '#/adapter/form';
import { getEmailConfig, saveEmailConfig } from '../api';

const loading = ref(false);
const configId = ref<number>(0);

onMounted(async () => {
  loading.value = true;
  try {
    const result = await getEmailConfig();
    if (result && Object.keys(result).length > 0) {
      configId.value = result.id || 0;
      baseFormApi.setValues(result);
    }
  } finally {
    loading.value = false;
  }
});

const [BaseForm, baseFormApi] = useVbenForm({
  commonConfig: {
    colon: true,
    componentProps: { class: 'w-full' },
  },
  handleSubmit: onSubmit,
  layout: 'horizontal',
  schema: [
    {
      fieldName: 'smtpServer',
      component: 'Input',
      label: 'SMTP服务器',
      rules: 'required',
      componentProps: {
        placeholder: '如: smtp.gmail.com',
        allowClear: true,
      },
    },
    {
      fieldName: 'smtpPort',
      component: 'InputNumber',
      label: 'SMTP端口',
      rules: 'required',
      defaultValue: 587,
      componentProps: {
        placeholder: '如: 587 或 465',
        min: 1,
        max: 65535,
      },
    },
    {
      fieldName: 'username',
      component: 'Input',
      label: '用户名',
      rules: 'required',
      componentProps: {
        placeholder: '请输入SMTP用户名',
        allowClear: true,
      },
    },
    {
      fieldName: 'password',
      component: 'InputPassword',
      label: '密码',
      componentProps: {
        placeholder: '请输入密码，不修改请留空',
        allowClear: true,
        visibilityToggle: true,
      },
    },
    {
      fieldName: 'fromEmail',
      component: 'Input',
      label: '发件人邮箱',
      rules: 'required',
      componentProps: {
        placeholder: '如: noreply@example.com',
        allowClear: true,
      },
    },
    {
      fieldName: 'fromName',
      component: 'Input',
      label: '发件人名称',
      rules: 'required',
      componentProps: {
        placeholder: '如: System Support',
        allowClear: true,
      },
    },
    {
      fieldName: 'enableSsl',
      component: 'Switch',
      label: '启用SSL',
      defaultValue: true,
      componentProps: {
        checkedChildren: '是',
        unCheckedChildren: '否',
      },
    },
    {
      fieldName: 'isActive',
      component: 'Switch',
      label: '是否激活',
      defaultValue: true,
      componentProps: {
        checkedChildren: '是',
        unCheckedChildren: '否',
      },
    },
  ],
  wrapperClass: 'grid-cols-1 md:grid-cols-2',
  submitButtonOptions: {
    text: '保存配置',
  },
  resetButtonOptions: {
    text: '重置',
  },
});

async function onSubmit(values: Record<string, any>) {
  loading.value = true;
  try {
    // toast (成功/失败) 由 axios 拦截器统一弹
    await saveEmailConfig(values);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <Card title="SMTP 邮件配置" :loading="loading" style="margin: 10px">
    <BaseForm />
  </Card>
</template>
