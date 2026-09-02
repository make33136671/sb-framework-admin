<script lang="ts" setup>
import { ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  message as Message,
} from 'ant-design-vue';

import { api } from '#/api/request';

interface SetupConfig {
  version: string;
  exportedAt: string;
  database: {
    dbType: string;
    server: string;
    port: string;
    database: string;
    user: string;
    password: string;
  };
  cache: {
    enabled: boolean;
    provider: string;
    redis: { connection: string; instanceName: string };
  };
  app: {
    productCn: string;
    productEn: string;
    primaryDomain: string;
    timeZone: string;
    cachePrefix: string;
    corsAllowAll: boolean;
    corsOrigins: string[];
    passwordStorageMode: string;
    cloudServerUrl: string;
  };
  admin: { username: string; displayName: string; password: string };
}

const exporting = ref(false);
const summary = ref<SetupConfig | null>(null);

async function exportConfig() {
  exporting.value = true;
  try {
    const config = await api.get<SetupConfig>('/SetupConfig/Export');
    summary.value = config;
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: 'application/json',
    });
    // 文件名：{项目名}-setup-config-{yyyyMMdd}.json（项目名取 productEn，如 tgvault-setup-config-20260902.json）
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateTag = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const fileName = `${config.app.productEn || 'sb'}-setup-config-${dateTag}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    Message.success(`配置已导出：${fileName}`);
  } catch (e: any) {
    Message.error(e?.message ?? '导出失败');
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <Page auto-content-height>
    <div class="space-y-4">
      <Card title="安装配置导出" size="small">
        <template #extra>
          <Button type="primary" :loading="exporting" @click="exportConfig">
            导出 setup-config.json
          </Button>
        </template>
        <div class="space-y-3">
          <Alert
            type="info"
            show-icon
            message="安装完成后仍可随时导出系统配置"
            description="导出内容取自系统当前生效配置（包含安装后通过运维工具或手工修改的最新值），格式与系统安装向导的「导入配置」完全兼容 —— 重新安装系统时，在安装向导中直接导入该文件即可完成预填。"
          />
          <Alert
            type="warning"
            show-icon
            message="导出文件包含数据库连接密码等敏感信息，请妥善保管"
            description="管理员密码为不可逆加密存储，不会被导出；重装导入后需重新设置管理员密码。"
          />

          <Descriptions
            v-if="summary"
            title="最近一次导出摘要"
            :column="2"
            size="small"
            bordered
          >
            <Descriptions.Item label="产品">
              {{ summary.app.productCn }}（{{ summary.app.productEn }}）
            </Descriptions.Item>
            <Descriptions.Item label="导出时间">
              {{ summary.exportedAt }}
            </Descriptions.Item>
            <Descriptions.Item label="数据库">
              {{ summary.database.dbType }} · {{ summary.database.server }}:{{
                summary.database.port
              }}/{{ summary.database.database }}
            </Descriptions.Item>
            <Descriptions.Item label="缓存">
              {{ summary.cache.provider }}
              {{ summary.cache.enabled ? '（启用）' : '（停用）' }}
            </Descriptions.Item>
            <Descriptions.Item label="主域名">
              {{ summary.app.primaryDomain || '-' }}
            </Descriptions.Item>
            <Descriptions.Item label="密码存储">
              {{ summary.app.passwordStorageMode }}
            </Descriptions.Item>
          </Descriptions>
        </div>
      </Card>
    </div>
  </Page>
</template>
