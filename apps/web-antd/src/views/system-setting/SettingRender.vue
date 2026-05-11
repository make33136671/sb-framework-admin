<script lang="ts" setup>
import { computed } from 'vue';

import { IconifyIcon } from '@vben/icons';

import {
  AutoComplete,
  Checkbox,
  DatePicker,
  Input,
  InputNumber,
  InputPassword,
  Mentions,
  Radio,
  Rate,
  Select,
  Switch,
  TimePicker,
  TreeSelect,
} from 'ant-design-vue';

import { IconPicker } from '@vben/common-ui';

import { SmartUpload } from '#/components/Upload';

const Textarea = Input.TextArea;
const RadioGroup = Radio.Group;
const CheckboxGroup = Checkbox.Group;
const RangePicker = DatePicker.RangePicker;

interface SettingItem {
  id: number;
  key: string;
  name: string;
  displayType: number;
  dataContent: null | string;
  dataContentConfig: string;
  cantDelete: boolean;
  sort: number;
}

const props = defineProps<{
  setting: SettingItem;
  modelValue: any;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: any];
}>();

const localValue = computed({
  get: () => props.modelValue,
  set: (val: any) => emit('update:modelValue', val),
});

/** 解析 dataContentConfig 为 JSON */
const config = computed(() => {
  try {
    if (props.setting.dataContentConfig) {
      return JSON.parse(props.setting.dataContentConfig);
    }
  } catch {
    // ignore
  }
  return null;
});

/** 选项类组件用的选项数组 */
const options = computed(() => {
  if (Array.isArray(config.value)) {
    return config.value;
  }
  return [];
});

/** Switch 在字符串 "true"/"false" 与 boolean 之间转换 */
const switchValue = computed({
  get: () => localValue.value === 'true' || localValue.value === true,
  set: (val: boolean) => {
    localValue.value = val ? 'true' : 'false';
  },
});

/** CheckboxGroup 在 JSON 字符串与数组之间转换 */
const checkboxValue = computed({
  get: () => {
    try {
      if (typeof localValue.value === 'string' && localValue.value) {
        return JSON.parse(localValue.value);
      }
    } catch {
      // ignore
    }
    return Array.isArray(localValue.value) ? localValue.value : [];
  },
  set: (val: any[]) => {
    localValue.value = JSON.stringify(val);
  },
});

/** RangePicker 在 JSON 字符串与数组之间转换 */
const rangeValue = computed({
  get: () => {
    try {
      if (typeof localValue.value === 'string' && localValue.value) {
        return JSON.parse(localValue.value);
      }
    } catch {
      // ignore
    }
    return Array.isArray(localValue.value) ? localValue.value : [];
  },
  set: (val: any) => {
    localValue.value = val ? JSON.stringify(val) : '';
  },
});

/** 兼容旧绝对 URL：strip 域名转相对路径 */
function stripHost(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '');
}

/** Case 6 单图：modelValue 是 string，可能是旧绝对 URL */
const imageValue = computed<string>({
  get: () => {
    const v = props.modelValue;
    if (typeof v !== 'string' || !v) return '';
    return stripHost(v);
  },
  set: (v: string) => emit('update:modelValue', v),
});

/** Case 17 多图：modelValue 是 JSON.stringify(string[])（旧约定） */
const multiImageValue = computed<string[]>({
  get: () => {
    const v = props.modelValue;
    try {
      const arr = typeof v === 'string' && v.trim() ? JSON.parse(v) : v;
      if (Array.isArray(arr)) return arr.map((u: string) => stripHost(u));
    } catch {
      // ignore
    }
    return [];
  },
  set: (v: string[]) => emit('update:modelValue', JSON.stringify(v)),
});

/** Case 18 多文件：modelValue 是 JSON.stringify(string[]) */
const filesValue = computed<string[]>({
  get: () => {
    const v = props.modelValue;
    try {
      const arr = typeof v === 'string' && v.trim() ? JSON.parse(v) : v;
      if (Array.isArray(arr)) return arr.map((u: string) => stripHost(u));
    } catch {
      // ignore
    }
    return [];
  },
  set: (v: string[]) => emit('update:modelValue', JSON.stringify(v)),
});

/** maxCount / accept 来自配置 */
const maxCount = computed(() => config.value?.maxCount);
const acceptTypes = computed(() => config.value?.accept || '');

/** 上传模式：auto(智能) / direct(普通) / chunk(切片)，默认 auto */
const uploadMode = computed<'auto' | 'chunk' | 'direct'>(() => {
  const m = config.value?.mode;
  return m === 'direct' || m === 'chunk' ? m : 'auto';
});
</script>

<template>
  <!-- Input (0) -->
  <Input
    v-if="setting.displayType === 0"
    v-model:value="localValue"
    :placeholder="config?.placeholder || `请输入${setting.name}`"
    allow-clear
  />

  <!-- InputTextArea (1) -->
  <Textarea
    v-else-if="setting.displayType === 1"
    v-model:value="localValue"
    :placeholder="config?.placeholder || `请输入${setting.name}`"
    :rows="4"
    allow-clear
  />

  <!-- RadioGroup (2) -->
  <RadioGroup
    v-else-if="setting.displayType === 2"
    v-model:value="localValue"
    :options="options"
  />

  <!-- Select (3) -->
  <Select
    v-else-if="setting.displayType === 3"
    v-model:value="localValue"
    :options="options"
    :placeholder="`请选择${setting.name}`"
    allow-clear
    style="width: 100%"
  />

  <!-- CheckboxGroup (4) -->
  <CheckboxGroup
    v-else-if="setting.displayType === 4"
    v-model:value="checkboxValue"
    :options="options"
  />

  <!-- Switch (5) -->
  <Switch
    v-else-if="setting.displayType === 5"
    v-model:checked="switchValue"
  />

  <!-- ImageUpload (6) -->
  <SmartUpload
    v-else-if="setting.displayType === 6"
    type="image"
    v-model:value="imageValue"
    :force-mode="uploadMode"
  />

  <!-- InputNumber (7) -->
  <InputNumber
    v-else-if="setting.displayType === 7"
    v-model:value="localValue"
    :min="config?.min"
    :max="config?.max"
    :step="config?.step"
    :placeholder="`请输入${setting.name}`"
    style="width: 100%"
  />

  <!-- InputPassword (8) -->
  <InputPassword
    v-else-if="setting.displayType === 8"
    v-model:value="localValue"
    :placeholder="config?.placeholder || `请输入${setting.name}`"
    allow-clear
  />

  <!-- DatePicker (9) -->
  <DatePicker
    v-else-if="setting.displayType === 9"
    v-model:value="localValue"
    :format="config?.format"
    style="width: 100%"
  />

  <!-- TimePicker (10) -->
  <TimePicker
    v-else-if="setting.displayType === 10"
    v-model:value="localValue"
    :format="config?.format"
    style="width: 100%"
  />

  <!-- RangePicker (11) -->
  <RangePicker
    v-else-if="setting.displayType === 11"
    v-model:value="rangeValue"
    :format="config?.format"
    style="width: 100%"
  />

  <!-- Rate (12) -->
  <Rate
    v-else-if="setting.displayType === 12"
    v-model:value="localValue"
    :count="config?.count || 5"
    :allow-half="config?.allowHalf || false"
  />

  <!-- AutoComplete (13) -->
  <AutoComplete
    v-else-if="setting.displayType === 13"
    v-model:value="localValue"
    :options="options"
    :placeholder="`请输入${setting.name}`"
    style="width: 100%"
  />

  <!-- Mentions (14) -->
  <Mentions
    v-else-if="setting.displayType === 14"
    v-model:value="localValue"
    :options="options"
    :placeholder="`请输入${setting.name}`"
  />

  <!-- TreeSelect (15) -->
  <TreeSelect
    v-else-if="setting.displayType === 15"
    v-model:value="localValue"
    :tree-data="config"
    :placeholder="`请选择${setting.name}`"
    allow-clear
    style="width: 100%"
  />

  <!-- IconPicker (16) -->
  <IconPicker
    v-else-if="setting.displayType === 16"
    v-model:value="localValue"
    :placeholder="`请选择${setting.name}`"
    :input-component="Input"
    icon-slot="addonAfter"
    model-value-prop="value"
  />

  <!-- MultiImageUpload (17) -->
  <SmartUpload
    v-else-if="setting.displayType === 17"
    type="images"
    v-model:value="multiImageValue"
    :max-count="maxCount"
    :force-mode="uploadMode"
  />

  <!-- FileUpload (18) -->
  <SmartUpload
    v-else-if="setting.displayType === 18"
    type="files"
    v-model:value="filesValue"
    :accept="acceptTypes"
    :max-count="maxCount"
    :force-mode="uploadMode"
  />

  <!-- Fallback -->
  <Input
    v-else
    v-model:value="localValue"
    :placeholder="`请输入${setting.name}`"
    allow-clear
  />
</template>
