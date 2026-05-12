<script lang="ts" setup>
import { computed, ref } from 'vue';

import { IconifyIcon } from '@vben/icons';

import {
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Textarea,
} from 'ant-design-vue';

/**
 * JSON 字段递归编辑器 — 把 JS 对象 / 数组按值类型映射到 antd 组件:
 *   string  → <Input>(含 \n 时自动 <Textarea>;path 命中 enumOptions 时 <Select>)
 *   number  → <InputNumber>
 *   boolean → <Switch>
 *   null    → <Input placeholder="null">(允许填入 string,变成 string)
 *   array   → <Card> + 每项递归 + +/- 按钮(允许加删数组元素)
 *   object  → <Card> + 每个 key:value 递归(不允许加删 key,字段集由后端 schema 决定)
 *
 * 用途:任何 schema 不固定的 JSON 编辑场景。
 *
 * 已知枚举字段:外部传 enumOptions(path → string[] / SelectOption[]),命中后渲染为 Select。
 * 数组项**不带 index**,例:DeployConfig.Projects 数组每项的 Key 字段 path 是 'DeployConfig.Projects.Key'。
 */
defineOptions({ name: 'JsonFieldEditor' });

export interface JsonFieldEnumOption {
  label?: string;
  value: string;
}

const props = withDefaults(
  defineProps<{
    /** 当前值(v-model);可以是 object / array / primitive */
    modelValue: any;
    /** 当前字段名;数组项用 index,对象 key 用 key */
    fieldKey?: number | string;
    /** 嵌套深度,只用于 UI 缩进 */
    depth?: number;
    /** 当前节点的 path(对象嵌套用 `parent.child`,数组项继承数组的 path 不加 index) */
    path?: string;
    /** 已知枚举字段:key = path,value = options 数组 */
    enumOptions?: Record<string, (JsonFieldEnumOption | string)[]>;
  }>(),
  {
    depth: 0,
    enumOptions: () => ({}),
    fieldKey: undefined,
    path: '',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: any];
}>();

const fieldType = computed(() => {
  const v = props.modelValue;
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // 'string' | 'number' | 'boolean' | 'object'
});

function update(value: any) {
  emit('update:modelValue', value);
}

function updateChild(key: number | string, child: any) {
  const cloned = Array.isArray(props.modelValue)
    ? [...props.modelValue]
    : { ...props.modelValue };
  (cloned as any)[key] = child;
  emit('update:modelValue', cloned);
}

function isMultiline(s: any) {
  return typeof s === 'string' && (s.includes('\n') || s.length > 80);
}

// ===== array 加删 =====

function addArrayItem() {
  if (!Array.isArray(props.modelValue)) return;
  const arr = [...props.modelValue];
  const sample = arr[0];
  let newItem: any = '';
  if (typeof sample === 'number') newItem = 0;
  else if (typeof sample === 'boolean') newItem = false;
  else if (Array.isArray(sample)) newItem = [];
  else if (typeof sample === 'object' && sample !== null) {
    // 复制现有 item 的 key 集合,值清空 — 让用户能填入相同结构
    newItem = Object.fromEntries(
      Object.entries(sample).map(([k, v]) => {
        if (typeof v === 'number') return [k, 0];
        if (typeof v === 'boolean') return [k, false];
        if (Array.isArray(v)) return [k, []];
        if (typeof v === 'object' && v !== null) return [k, {}];
        return [k, ''];
      }),
    );
  }
  arr.push(newItem);
  emit('update:modelValue', arr);
}

function removeArrayItem(index: number) {
  if (!Array.isArray(props.modelValue)) return;
  const arr = [...props.modelValue];
  arr.splice(index, 1);
  emit('update:modelValue', arr);
}

// ===== 折叠 =====
// root 节点(fieldKey === undefined)始终展开 — 折了就什么都看不见。
// 嵌套节点默认展开,用户可点击 title 区折叠。
const collapsed = ref(false);
const collapsible = computed(() => props.fieldKey !== undefined);
function toggleCollapse() {
  if (collapsible.value) collapsed.value = !collapsed.value;
}

// ===== path 递归 + enum 匹配 =====
function childPath(key: number | string): string {
  // 数组项继承父 path(不加 index),让 enumOptions 配 "Projects.Key" 就能覆盖所有 Projects[*].Key
  if (Array.isArray(props.modelValue)) return props.path;
  return props.path ? `${props.path}.${key}` : String(key);
}

// path 匹配 enumOptions 的逻辑:
//   1. 完全匹配优先(如 'DbConfig.DbType')
//   2. 不命中则从右往左把末尾段换 '*' 尝试通配(如 'Logging.LogLevel.*' 匹配
//      'Logging.LogLevel.Default' / 'Logging.LogLevel.Microsoft.Hosting.Lifetime')
//   这让任意命名空间的字典字段(LogLevel 等)能用一条 enum 配置覆盖
function findEnumOptions(
  path: string,
  options: Record<string, (JsonFieldEnumOption | string)[]>,
) {
  if (options[path]) return options[path];
  const segs = path.split('.');
  for (let i = segs.length - 1; i >= 1; i--) {
    const wildcardPath = [...segs.slice(0, i), '*'].join('.');
    if (options[wildcardPath]) return options[wildcardPath];
  }
  return null;
}

const enumMatch = computed(() => {
  if (!props.path) return null;
  const raw = findEnumOptions(props.path, props.enumOptions);
  if (!raw || raw.length === 0) return null;
  // 归一化:string[] → SelectOption[]
  return raw.map((o) =>
    typeof o === 'string' ? { label: o, value: o } : o,
  );
});
</script>

<template>
  <!-- 已知枚举:string / null 命中 enumOptions 时优先 Select -->
  <Select
    v-if="enumMatch && (fieldType === 'string' || fieldType === 'null')"
    :value="modelValue ?? ''"
    :options="enumMatch"
    show-search
    style="width: 100%"
    @update:value="update"
  />
  <!-- string,单行 -->
  <Input
    v-else-if="fieldType === 'string' && !isMultiline(modelValue)"
    :value="modelValue"
    @update:value="update"
  />
  <!-- string,多行 -->
  <Textarea
    v-else-if="fieldType === 'string'"
    :value="modelValue"
    :auto-size="{ minRows: 2, maxRows: 10 }"
    @update:value="update"
  />
  <!-- number -->
  <InputNumber
    v-else-if="fieldType === 'number'"
    :value="modelValue"
    style="width: 100%"
    @update:value="update"
  />
  <!-- boolean -->
  <Switch
    v-else-if="fieldType === 'boolean'"
    :checked="modelValue"
    @update:checked="update"
  />
  <!-- null -->
  <Input
    v-else-if="fieldType === 'null'"
    :value="''"
    placeholder="null (填入后变为字符串)"
    @update:value="update"
  />
  <!-- array -->
  <Card v-else-if="fieldType === 'array'" size="small">
    <template #title>
      <div
        :class="['card-title', { clickable: collapsible }]"
        @click="toggleCollapse"
      >
        <IconifyIcon
          v-if="collapsible"
          :icon="collapsed ? 'ion:chevron-forward' : 'ion:chevron-down'"
          class="collapse-icon"
        />
        <span>{{ fieldKey ?? '数组' }}</span>
        <Tag color="default">{{ modelValue.length }} 项</Tag>
      </div>
    </template>
    <template #extra>
      <Button size="small" type="default" @click="addArrayItem">
        <IconifyIcon icon="ion:add" />
        添加
      </Button>
    </template>
    <div v-show="!collapsed">
      <Empty
        v-if="modelValue.length === 0"
        description="空数组"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
      />
      <div
        v-for="(item, idx) in modelValue"
        :key="idx"
        class="array-item"
      >
        <div class="array-item-index">
          <Tag color="default">{{ idx }}</Tag>
        </div>
        <div class="array-item-body">
          <JsonFieldEditor
            :model-value="item"
            :depth="depth + 1"
            :path="childPath(idx)"
            :enum-options="enumOptions"
            @update:model-value="(v: any) => updateChild(idx, v)"
          />
        </div>
        <Button
          size="small"
          danger
          type="default"
          @click="removeArrayItem(idx)"
        >
          <IconifyIcon icon="ion:remove" />
        </Button>
      </div>
    </div>
  </Card>
  <!-- object -->
  <Card v-else-if="fieldType === 'object'" size="small">
    <template v-if="collapsible" #title>
      <div class="card-title clickable" @click="toggleCollapse">
        <IconifyIcon
          :icon="collapsed ? 'ion:chevron-forward' : 'ion:chevron-down'"
          class="collapse-icon"
        />
        <span>{{ fieldKey }}</span>
        <Tag color="default">{{ Object.keys(modelValue).length }} 字段</Tag>
      </div>
    </template>
    <div v-show="!collapsed">
      <div
        v-for="(value, key) in modelValue"
        :key="String(key)"
        class="object-field"
      >
        <div class="object-field-label">{{ key }}</div>
        <div class="object-field-body">
          <JsonFieldEditor
            :model-value="value"
            :field-key="String(key)"
            :depth="depth + 1"
            :path="childPath(String(key))"
            :enum-options="enumOptions"
            @update:model-value="(v: any) => updateChild(String(key), v)"
          />
        </div>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.array-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}
.array-item-index {
  flex-shrink: 0;
  padding-top: 4px;
}
.array-item-body {
  flex: 1;
  min-width: 0;
}

.object-field {
  margin-bottom: 12px;
}
.object-field-label {
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ant-color-text-secondary);
}
.object-field-body {
  padding-left: 4px;
}

.card-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  user-select: none;
}
.card-title.clickable {
  cursor: pointer;
}
.card-title.clickable:hover {
  color: var(--ant-color-primary);
}
.collapse-icon {
  font-size: 14px;
  color: var(--ant-color-text-tertiary);
  transition: transform 0.15s;
}
.card-title.clickable:hover .collapse-icon {
  color: var(--ant-color-primary);
}
</style>
