<script lang="ts" setup>
import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAppConfig } from '@vben/hooks';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  message as Message,
} from 'ant-design-vue';

import { api } from '#/api/request';

interface BrandSpec {
  monogram: string;
  productCn: string;
  productEn: string;
  accentFrom: string;
  accentTo: string;
  darkBg: string;
  lightBg: string;
  monoColor: string;
  generatedAt: string;
}

interface BrandCurrent {
  generated: boolean;
  spec: BrandSpec;
  assets?: {
    files: string[];
    preview: string[];
  };
}

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

const loading = ref(false);
const regenerating = ref(false);
const generated = ref(false);
const cacheBust = ref(Date.now());
const monogram = ref('SB');
const accentFrom = ref('#22D3EE');
const accentTo = ref('#3B82F6');
const files = ref<string[]>([]);

async function loadCurrent() {
  loading.value = true;
  try {
    const data = await api.get<BrandCurrent>('/Brand/Current');
    generated.value = data.generated;
    monogram.value = data.spec.monogram;
    accentFrom.value = data.spec.accentFrom;
    accentTo.value = data.spec.accentTo;
    files.value = data.assets?.files ?? [];
  } finally {
    loading.value = false;
  }
}

async function regenerate() {
  const mono = monogram.value.trim().toUpperCase();
  if (mono.length === 0 || mono.length > 3) {
    Message.warning('单字标必须是 1-3 个字符');
    return;
  }
  regenerating.value = true;
  try {
    const data = await api.post<{
      assets: { files: string[] };
    }>('/Brand/Regenerate', {
      monogram: mono,
      accentFrom: accentFrom.value,
      accentTo: accentTo.value,
    });
    generated.value = true;
    files.value = data.assets?.files ?? [];
    cacheBust.value = Date.now();
    Message.success('品牌图标已重新生成');
  } catch {
    // api.post 已弹错误提示
  } finally {
    regenerating.value = false;
  }
}

async function downloadZip() {
  const accessStore = useAccessStore();
  const resp = await fetch(`${apiURL}/Brand/Download`, {
    headers: { Authorization: `Bearer ${accessStore.accessToken}` },
  });
  if (!resp.ok) {
    Message.error('下载失败');
    return;
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'brand-assets.zip';
  a.click();
  URL.revokeObjectURL(url);
}

const preview = (name: string) => `/storage/brand/${name}?t=${cacheBust.value}`;

onMounted(() => {
  loadCurrent();
});
</script>

<template>
  <Page auto-content-height>
    <div class="space-y-4">
      <Card :loading="loading" size="small" title="SB 品牌图标生成">
        <template #extra>
          <Button
            v-if="generated"
            size="small"
            type="default"
            @click="downloadZip"
          >
            打包下载 zip
          </Button>
          <Button
            :loading="regenerating"
            size="small"
            type="primary"
            @click="regenerate"
          >
            {{ generated ? '重新生成' : '生成' }}
          </Button>
        </template>

        <div class="space-y-3">
          <Alert
            type="info"
            show-icon
            message="按 SB 品牌风格（六边形 + 青→蓝渐变 + 单字标）生成全套项目图标"
            description="产物：favicon 集（favicon.ico / 16 / 32 / apple-touch / android-chrome，覆盖安装向导产物）+ brand/ 目录（SVG 矢量原件、横版锁形 PNG、icon 大图、brand.json 规格）。未上传 Logo 的系统在安装时已按产品名自动生成过一次。"
          />

          <Form layout="inline">
            <Form.Item label="单字标（1-3 字符）">
              <Input
                v-model:value="monogram"
                :maxlength="3"
                placeholder="如 TG / SB"
                style="width: 120px; text-transform: uppercase"
              />
            </Form.Item>
            <Form.Item label="渐变起色">
              <Input v-model:value="accentFrom" style="width: 110px" />
            </Form.Item>
            <Form.Item label="渐变止色">
              <Input v-model:value="accentTo" style="width: 110px" />
            </Form.Item>
          </Form>

          <div v-if="generated" class="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div
              class="rounded border border-gray-200 p-3 dark:border-gray-700"
            >
              <div class="mb-2 text-xs text-gray-500">
                深色 mark（mark-dark.svg）
              </div>
              <img
                :src="preview('mark-dark.svg')"
                class="h-28"
                alt="mark-dark"
              />
            </div>
            <div
              class="rounded border border-gray-200 p-3 dark:border-gray-700"
            >
              <div class="mb-2 text-xs text-gray-500">
                浅色 mark（mark-light.svg）
              </div>
              <img
                :src="preview('mark-light.svg')"
                class="h-28"
                alt="mark-light"
              />
            </div>
            <div
              class="rounded border border-gray-200 p-3 lg:col-span-1 dark:border-gray-700"
            >
              <div class="mb-2 text-xs text-gray-500">
                横版锁形（horizontal-dark.svg）
              </div>
              <img
                :src="preview('horizontal-dark.svg')"
                class="h-28"
                alt="horizontal"
              />
            </div>
          </div>

          <Descriptions
            v-if="generated && files.length > 0"
            :column="1"
            size="small"
            bordered
            title="brand/ 目录产物"
          >
            <Descriptions.Item label="文件清单">
              {{ files.join('、') }}
            </Descriptions.Item>
            <Descriptions.Item label="favicon 路径">
              /storage/favicon.ico（同步更新，前端引用无需改动）
            </Descriptions.Item>
          </Descriptions>
        </div>
      </Card>
    </div>
  </Page>
</template>
