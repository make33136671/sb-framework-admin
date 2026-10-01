<script lang="ts" setup>
/**
 * ProviderFormDrawer —— 添加/编辑 AI 提供商（前端设计 §2.2）
 *
 * 字段规则（逐条落地）：
 *   - 「接入类型」下拉数据来自 `AiProviderAdmin/AdapterTypes`（**动态**，不硬编码）；
 *   - 选中类型后 baseUrl 预填 `defaultBaseUrl`，并提示所需信息（requiresApiKey / 支持能力 / 能否拉模型）；
 *   - `requiresApiKey=false` → Key 输入框禁用并提示「该类型无需密钥」；
 *   - **密钥永不回显明文**（编辑时只显示「已配置」徽标，留空 = 不修改）；
 *   - `adapterConfig` 仅在该适配器有配置需求时显示（comfyui: timeout / default_workflow_id），
 *     以 JSON 文本框编辑，保存前做一次 JSON 合法性检查（后端 ValidateConfig 是最终防线）。
 *
 * 保存前**不强制**测试连通性（允许先存后测），保存后由父组件提示去测。
 * 不写配对 toast（拦截器已统一处理）。
 */
import { computed, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Drawer,
  Input,
  InputNumber,
  message,
  Select,
  Space,
  Switch,
  Tag,
} from 'ant-design-vue';

import type {
  AiAdapterType,
  AiProviderAdminItem,
} from '#/api/core/aiProviderAdmin';

import { AI_CAPABILITY_OPTIONS } from '#/api/core/aiProvider';
import {
  aiProviderAdapterTypes,
  aiProviderAdminSave,
} from '#/api/core/aiProviderAdmin';

const props = defineProps<{
  open: boolean;
  /** null = 新建 */
  editing: AiProviderAdminItem | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'saved', id: number): void;
}>();

// ─────────────────────────── 接入类型 ───────────────────────────

const adapters = ref<AiAdapterType[]>([]);
const adaptersLoaded = ref(false);

async function loadAdapters() {
  try {
    adapters.value = (await aiProviderAdapterTypes()) ?? [];
  } catch {
    adapters.value = [];
  } finally {
    adaptersLoaded.value = true;
  }
}
void loadAdapters();

const adapterOptions = computed(() =>
  adapters.value.map((a) => ({
    label: a.displayName,
    value: a.providerKey,
  })),
);

// ─────────────────────────── 表单 ───────────────────────────

interface FormState {
  id?: number;
  name: string;
  providerKey: string;
  baseUrl: string;
  apiKey: string;
  adapterConfig: string;
  isEnabled: boolean;
  sortNo: number;
  remark: string;
}

function blank(): FormState {
  return {
    name: '',
    providerKey: '',
    baseUrl: '',
    apiKey: '',
    adapterConfig: '',
    isEnabled: true,
    sortNo: 0,
    remark: '',
  };
}

const form = ref<FormState>(blank());
const saving = ref(false);

const currentAdapter = computed(() =>
  adapters.value.find((a) => a.providerKey === form.value.providerKey),
);

/** 编辑态：密钥已配置（只显示徽标，永不回显明文） */
const hasExistingKey = computed(() => Boolean(props.editing?.hasApiKey));

watch(
  () => props.open,
  (v) => {
    if (!v) return;
    const e = props.editing;
    if (e) {
      form.value = {
        id: e.id,
        name: e.name,
        providerKey: e.providerKey,
        baseUrl: e.baseUrl ?? '',
        apiKey: '',
        adapterConfig: e.adapterConfig ?? '',
        isEnabled: e.isEnabled,
        sortNo: e.sortNo ?? 0,
        remark: e.remark ?? '',
      };
    } else {
      form.value = blank();
      // 新建时预选第一个适配器，减少一次点击
      const first = adapters.value.at(0);
      if (first) {
        form.value.providerKey = first.providerKey;
        form.value.baseUrl = first.defaultBaseUrl ?? '';
      }
    }
  },
);

/** 切换接入类型：预填默认地址 + 清掉不适用的 adapterConfig */
function onAdapterChange(key: unknown) {
  if (typeof key !== 'string') return;
  const a = adapters.value.find((x) => x.providerKey === key);
  form.value.baseUrl = a?.defaultBaseUrl ?? '';
}

function restoreDefaultBaseUrl() {
  form.value.baseUrl = currentAdapter.value?.defaultBaseUrl ?? '';
}

/** 该适配器是否需要 adapterConfig（目前仅 comfyui 有可配项） */
const needsAdapterConfig = computed(() => form.value.providerKey === 'comfyui');

/** 该适配器支持能力的中文名（提示条用） */
const supportedCapabilityText = computed(() => {
  const mask = currentAdapter.value?.supportedCapabilities ?? 0;
  const names = AI_CAPABILITY_OPTIONS.filter((o) => (mask & o.value) !== 0).map(
    (o) => o.label,
  );
  return names.length > 0 ? names.join('、') : '（适配器未声明）';
});

/** adapterConfig 文本 → 合法 JSON 字符串（空 = 不设置） */
function normalizeConfig(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const obj = JSON.parse(t) as unknown;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('adapter_config 必须是 JSON 对象');
  }
  return JSON.stringify(obj);
}

async function submit() {
  const f = form.value;
  if (!f.providerKey) {
    message.error('请选择接入类型');
    return;
  }
  if (!f.name.trim()) {
    message.error('请填写名称');
    return;
  }
  if (currentAdapter.value?.requiresApiKey && !f.id && !f.apiKey.trim()) {
    message.error('该接入类型需要填写 API Key');
    return;
  }
  let adapterConfig: string | undefined;
  try {
    adapterConfig = normalizeConfig(f.adapterConfig);
  } catch (error) {
    message.error(`配置不是合法的 JSON：${(error as Error).message}`);
    return;
  }

  saving.value = true;
  try {
    const r = await aiProviderAdminSave({
      id: f.id,
      name: f.name.trim(),
      providerKey: f.providerKey,
      baseUrl: f.baseUrl.trim() || undefined,
      apiKey: f.apiKey.trim() || undefined,
      adapterConfig,
      isEnabled: f.isEnabled,
      sortNo: f.sortNo,
      remark: f.remark.trim() || undefined,
    });
    emit('update:open', false);
    emit('saved', r?.id ?? f.id ?? 0);
  } catch {
    // 拦截器已提示
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Drawer
    :open="open"
    :title="editing ? `编辑提供商：${editing.name}` : '添加 AI 提供商'"
    :width="620"
    @close="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <!-- 接入类型 -->
      <div>
        <div class="mb-1 text-sm">接入类型 *</div>
        <Select
          v-model:value="form.providerKey"
          :loading="!adaptersLoaded"
          :options="adapterOptions"
          :placeholder="
            adaptersLoaded && adapters.length === 0
              ? '（未注册任何适配器）'
              : '请选择接入类型'
          "
          :disabled="Boolean(form.id)"
          style="width: 100%"
          @change="onAdapterChange"
        />
        <div class="mt-1 text-xs text-muted-foreground">
          选中后自动填充下方接口地址。接入类型由后端适配器动态提供（新增适配器无需改前端）。
        </div>
      </div>

      <!-- 名称 -->
      <div>
        <div class="mb-1 text-sm">名称 *</div>
        <Input
          v-model:value="form.name"
          placeholder="起个自己好认的名字（可叫「备用 DeepSeek」）"
        />
      </div>

      <!-- 接口地址 -->
      <div>
        <div class="mb-1 text-sm">
          接口地址<span v-if="currentAdapter?.requiresApiKey"> *</span>
        </div>
        <div class="flex items-center gap-2">
          <Input
            v-model:value="form.baseUrl"
            :placeholder="currentAdapter?.defaultBaseUrl || 'https://...'"
          />
          <Button
            v-if="currentAdapter?.defaultBaseUrl"
            size="small"
            @click="restoreDefaultBaseUrl"
          >
            恢复默认
          </Button>
        </div>
      </div>

      <!-- API Key -->
      <div>
        <div class="mb-1 flex items-center gap-2 text-sm">
          API Key<span v-if="currentAdapter?.requiresApiKey"> *</span>
          <Tag v-if="hasExistingKey" class="!mr-0" color="success">
            已配置
          </Tag>
        </div>
        <Input.Password
          v-model:value="form.apiKey"
          :disabled="currentAdapter ? !currentAdapter.requiresApiKey : false"
          :placeholder="
            currentAdapter && !currentAdapter.requiresApiKey
              ? '该类型无需密钥'
              : form.id
                ? '留空 = 不修改已保存的密钥'
                : 'sk-...'
          "
        />
        <div class="mt-1 text-xs text-muted-foreground">
          <template v-if="hasExistingKey">
            已保存的密钥不会回显；留空表示不修改。
          </template>
          <template v-else> 保存后可修改；留空表示不修改。 </template>
        </div>
      </div>

      <!-- 备注 / 排序 / 启用 -->
      <div>
        <div class="mb-1 text-sm">备注</div>
        <Input v-model:value="form.remark" placeholder="可选" />
      </div>

      <div class="flex items-center gap-6">
        <div>
          <div class="mb-1 text-sm">排序（小在前）</div>
          <InputNumber
            v-model:value="form.sortNo"
            :min="0"
            style="width: 140px"
          />
        </div>
        <div class="flex items-center gap-2 pt-5">
          <Switch v-model:checked="form.isEnabled" size="small" />
          <span class="text-sm">启用</span>
        </div>
      </div>

      <!-- adapterConfig（仅 comfyui 等有配置需求的适配器） -->
      <div v-if="needsAdapterConfig">
        <div class="mb-1 text-sm">适配器配置（JSON）</div>
        <Input.TextArea
          v-model:value="form.adapterConfig"
          :rows="5"
          placeholder='{"timeout":"600","default_workflow_id":"3"}'
        />
        <div class="mt-1 text-xs text-muted-foreground">
          ComfyUI
          可配：<code>timeout</code>（秒）、<code>poll_interval</code>（秒）、
          <code>default_workflow_id</code>（模型未绑工作流时的默认模板 id）。
          保存前后端会做配置校验，坏配置进不了库。
        </div>
      </div>

      <!-- 提示条：该类型支持的能力 -->
      <Alert show-icon type="info">
        <template #message>
          该接入类型支持的能力：{{ supportedCapabilityText }}
        </template>
        <template #description>
          <div class="text-xs">
            <template v-if="currentAdapter?.supportsModelList">
              点击「测试连通性」可拉取该厂商的模型列表。
            </template>
            <template v-else>
              该类型不提供模型列表（私有部署 / ComfyUI
              常见）：保存后请用「手工添加模型」。
            </template>
          </div>
        </template>
      </Alert>
    </div>

    <template #footer>
      <Space>
        <Button @click="emit('update:open', false)">取消</Button>
        <Button :loading="saving" type="primary" @click="submit">保存</Button>
      </Space>
    </template>
  </Drawer>
</template>
