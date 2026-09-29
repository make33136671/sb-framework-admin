<script lang="ts" setup>
/**
 * 洗稿细化选项面板
 *
 * 分组 A–E 折叠展示（A 集级结构 / B 集内结构与强化分析 / C 内容策略 / D 人物主线 / E 各动作强化）。
 * 面板只负责收集选项，翻译成提示词的逻辑在后端（RewriteOptions.BuildDirectives）。
 * v-model 绑定一个普通对象（键名与后端字段一一对应）。
 */
import { computed, ref, watch } from 'vue';

import {
  Button,
  Card,
  Collapse,
  InputNumber,
  Select,
  Slider,
  Space,
  Switch,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  defaultRewriteOptions,
  REWRITE_OPTION_GROUPS,
  REWRITE_PRESETS,
} from '#/composables/rewriteOptions';

const props = withDefaults(
  defineProps<{
    /** 当前剧目目标集数（作为「总集数」的初始参考） */
    episodeTargetCount?: number;
    /** 选项对象（键名与后端一致） */
    modelValue: Record<string, any>;
  }>(),
  { episodeTargetCount: 10 },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, any>): void;
}>();

/** 展开的分组（默认展开 A、B：最常用） */
const activeGroups = ref<string[]>(['A', 'B']);

/** 已开启的强化项数量（给个"你改了多少"的直观反馈） */
const changedCount = computed(() => {
  const def = defaultRewriteOptions();
  return Object.keys(props.modelValue).filter(
    (k) => JSON.stringify(props.modelValue[k]) !== JSON.stringify(def[k]),
  ).length;
});

/** 生效中的强化项（B 组 1–5 级里的非零项，面板顶部展示） */
const activeStrengths = computed(() => {
  const b = REWRITE_OPTION_GROUPS.find((g) => g.key === 'B');
  return (b?.options ?? [])
    .filter((o) => o.type === 'strength' && Number(props.modelValue[o.key]) > 0)
    .map((o) => `${o.label} ${props.modelValue[o.key]}级`);
});

function patch(v: Partial<Record<string, any>>) {
  emit('update:modelValue', { ...props.modelValue, ...v });
}

function applyPreset(preset: (typeof REWRITE_PRESETS)[number]) {
  emit('update:modelValue', { ...defaultRewriteOptions(), ...preset.patch });
}

/** 首次挂载时把「总集数」对齐剧目目标集数（仅当用户没动过） */
watch(
  () => props.episodeTargetCount,
  (n) => {
    if (n > 0 && props.modelValue.episodeCount === 10) {
      patch({ episodeCount: n });
    }
  },
  { immediate: true },
);

/** 数字型选项：直接改 */
function setNumber(key: string, v: any) {
  patch({ [key]: Number(v ?? 0) });
}

/** 强度型选项：0 = 关（Ant Slider 用 0–5） */
function setStrength(key: string, v: any) {
  patch({ [key]: Number(v ?? 0) });
}

defineExpose({ groups: REWRITE_OPTION_GROUPS });
</script>

<template>
  <Card class="df-rewrite-options" size="small" title="洗稿细化选项">
    <template #extra>
      <Space>
        <Tag v-if="changedCount > 0" color="processing" class="!mr-0">
          已调整 {{ changedCount }} 项
        </Tag>
        <Button
          size="small"
          @click="emit('update:modelValue', defaultRewriteOptions())"
        >
          重置
        </Button>
      </Space>
    </template>

    <!-- 预设 -->
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <span class="text-xs text-muted-foreground">预设：</span>
      <Tooltip v-for="p in REWRITE_PRESETS" :key="p.name" :title="p.desc">
        <Button size="small" @click="applyPreset(p)">{{ p.name }}</Button>
      </Tooltip>
    </div>

    <!-- 生效中的强化项 -->
    <div
      v-if="activeStrengths.length > 0"
      class="mb-3 flex flex-wrap items-center gap-1"
    >
      <span class="text-xs text-muted-foreground">已开启强化：</span>
      <Tag v-for="s in activeStrengths" :key="s" color="success" class="!mr-0">
        {{ s }}
      </Tag>
    </div>

    <Collapse v-model:active-key="activeGroups" size="small">
      <Collapse.Panel v-for="g in REWRITE_OPTION_GROUPS" :key="g.key">
        <template #header>
          <span class="font-medium">{{ g.title }}</span>
          <span class="ml-2 text-xs text-muted-foreground">{{ g.desc }}</span>
        </template>

        <div class="flex flex-col gap-3">
          <div
            v-for="o in g.options"
            :key="o.key"
            class="flex flex-wrap items-center gap-2"
          >
            <!-- 名称 + 说明 -->
            <div class="w-56 min-w-0">
              <div class="text-sm">{{ o.label }}</div>
              <div
                class="truncate text-xs text-muted-foreground"
                :title="o.desc"
              >
                {{ o.desc }}
              </div>
            </div>

            <!-- 开关 -->
            <Switch
              v-if="o.type === 'bool'"
              :checked="Boolean(modelValue[o.key])"
              size="small"
              @change="(v: any) => patch({ [o.key]: Boolean(v) })"
            />

            <!-- 下拉 -->
            <Select
              v-else-if="o.type === 'enum'"
              :options="
                (o as any).options.map((x: any) => ({
                  label: `${x.label}（${x.desc}）`,
                  value: x.value,
                }))
              "
              :value="modelValue[o.key]"
              style="min-width: 320px"
              @change="(v: any) => patch({ [o.key]: v })"
            />

            <!-- 数字 -->
            <template v-else-if="o.type === 'number'">
              <InputNumber
                :max="(o as any).max"
                :min="(o as any).min"
                :value="modelValue[o.key]"
                size="small"
                style="width: 110px"
                @change="(v: any) => setNumber(o.key, v)"
              />
              <span class="text-xs text-muted-foreground">
                {{ (o as any).suffix }}
              </span>
            </template>

            <!-- 强度 0–5 -->
            <template v-else>
              <Slider
                :max="5"
                :min="0"
                :step="1"
                :value="Number(modelValue[o.key] ?? 0)"
                :tip-formatter="(v?: number) => (v ? `${v} 级` : '关闭')"
                class="w-48"
                @change="(v: any) => setStrength(o.key, v)"
              />
              <Tag
                :color="Number(modelValue[o.key]) > 0 ? 'success' : 'default'"
                class="!mr-0"
              >
                {{
                  Number(modelValue[o.key]) > 0
                    ? `${modelValue[o.key]} 级`
                    : '关闭'
                }}
              </Tag>
              <span
                v-if="(o as any).detail"
                class="text-xs text-muted-foreground"
                :title="(o as any).detail"
              >
                {{ (o as any).detail }}
              </span>
            </template>
          </div>
        </div>
      </Collapse.Panel>
    </Collapse>
  </Card>
</template>
