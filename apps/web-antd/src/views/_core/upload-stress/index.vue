<script lang="ts" setup>
import { ref } from 'vue';

import { Alert, Card } from 'ant-design-vue';

import { ChunkUpload, DirectUpload, SmartUpload } from '#/components/Upload';

defineOptions({ name: 'UploadStress' });

/** DirectUpload 单图（强制直传） */
const single = ref<string>('');
/** ChunkUpload 多文件（强制切片） */
const multi = ref<string[]>([]);
/** SmartUpload 多文件（按阈值自动选） */
const smart = ref<string[]>([]);
</script>

<template>
  <div style="max-width: 1200px; padding: 24px; margin: 0 auto">
    <h1 style="margin-bottom: 16px; font-size: 20px; font-weight: 600">
      上传组件回归测试
    </h1>
    <Alert
      type="info"
      show-icon
      message="并发独立性 + 取消 + 重试 + 排队验证"
      description="同时在 3 个组件触发上传，预期：每个组件独立显示进度；取消按钮只取消自己；重试可恢复失败项；多文件排队（同时仅 1 个 uploading）。"
      style="margin-bottom: 16px"
    />
    <div
      style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px"
    >
      <Card
        title="DirectUpload 单图"
        size="small"
        style="display: flex; flex-direction: column"
        :body-style="{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
        }"
      >
        <DirectUpload type="image" v-model:value="single" />
        <pre style="margin: 0; font-size: 11px">v-model: {{ single }}</pre>
      </Card>
      <Card title="ChunkUpload 多文件" size="small">
        <ChunkUpload type="files" v-model:value="multi" />
        <pre style="margin-top: 12px; font-size: 11px">
v-model: {{ multi }}</pre
        >
      </Card>
      <Card title="SmartUpload 自动" size="small">
        <SmartUpload type="files" v-model:value="smart" />
        <pre style="margin-top: 12px; font-size: 11px">
v-model: {{ smart }}</pre
        >
      </Card>
    </div>
    <div style="margin-top: 24px; font-size: 12px; color: rgb(0 0 0 / 45%)">
      路由：<code>/test/upload-stress</code>（dev 调试用）。 后端 dev
      限速：1500ms/片（appsettings.Development.json
      UploadConfig.DebugThrottleMs）。
    </div>
  </div>
</template>
