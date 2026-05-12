<script lang="ts" setup>
import type { editor as MonacoEditorNS } from 'monaco-editor';

import { computed, shallowRef } from 'vue';

import { usePreferences } from '@vben/preferences';

import { loader, VueMonacoEditor } from '@guolao/vue-monaco-editor';

// @ts-expect-error - vite 'as worker' import 没有 type
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
// @ts-expect-error - vite 'as worker' import 没有 type
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
// @ts-expect-error - vite 'as worker' import 没有 type
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

import * as monaco from 'monaco-editor';

// 一次性把本地 monaco-editor(node_modules) 注入到 vue-monaco-editor,避免 CDN 加载
// 并配置 worker(Vite '?worker' 后缀会生成独立 chunk,production build 安全)
let __monacoConfigured = false;
function ensureMonacoConfigured() {
  if (__monacoConfigured) return;
  // @ts-expect-error - self.MonacoEnvironment 是 monaco 全局约定
  self.MonacoEnvironment = {
    getWorker(_: any, label: string) {
      if (label === 'json') return new jsonWorker();
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };
  loader.config({ monaco });
  __monacoConfigured = true;
}
ensureMonacoConfigured();

/**
 * 通用 JSON 编辑器(Monaco 包装)。
 *
 * 用途:任何需要 JSON / yaml / javascript 等结构化文本编辑的场景。
 * 不限定 JSON — 改 language 即可写别的语言。
 */
const props = withDefaults(
  defineProps<{
    /** 当前内容(v-model) */
    modelValue: string;
    /** Monaco 语言;默认 'json' */
    language?: string;
    /** 只读模式 */
    readonly?: boolean;
    /** 容器高度;number 自动加 px;字符串原样 */
    height?: number | string;
    /** 主题;'auto' 跟随 Vben 亮/暗 */
    theme?: 'auto' | 'vs-dark' | 'vs';
    /** 额外 Monaco options,会浅合并到默认 options */
    options?: Record<string, any>;
  }>(),
  {
    language: 'json',
    readonly: false,
    height: 400,
    theme: 'auto',
    options: () => ({}),
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [value: string];
}>();

const { isDark } = usePreferences();

const resolvedTheme = computed(() => {
  if (props.theme !== 'auto') return props.theme;
  return isDark.value ? 'vs-dark' : 'vs';
});

const heightStyle = computed(() =>
  typeof props.height === 'number' ? `${props.height}px` : props.height,
);

const defaultOptions = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  tabSize: 2,
  lineNumbers: 'on',
  automaticLayout: true,
  formatOnPaste: true,
};

const mergedOptions = computed(() => ({
  ...defaultOptions,
  readOnly: props.readonly,
  ...props.options,
}));

const editorRef = shallowRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);

function handleMount(editor: MonacoEditorNS.IStandaloneCodeEditor) {
  editorRef.value = editor;
}

function handleChange(value: string | undefined) {
  const v = value ?? '';
  emit('update:modelValue', v);
  emit('change', v);
}

/** 触发 Monaco 内置格式化(JSON / 其他支持的语言通用) */
function format() {
  editorRef.value?.getAction?.('editor.action.formatDocument')?.run?.();
}

/** 当 language='json' 时本地 JSON.parse 校验 */
function validate(): { ok: true } | { error: string; ok: false } {
  if (props.language !== 'json') return { ok: true };
  try {
    JSON.parse(props.modelValue);
    return { ok: true };
  } catch (error: any) {
    return { error: error.message, ok: false };
  }
}

defineExpose({ editor: editorRef, format, validate });
</script>

<template>
  <div :style="{ height: heightStyle }" class="json-editor-wrapper">
    <VueMonacoEditor
      :language="language"
      :options="mergedOptions"
      :theme="resolvedTheme"
      :value="modelValue"
      height="100%"
      width="100%"
      @mount="handleMount"
      @update:value="handleChange"
    />
  </div>
</template>

<style scoped>
.json-editor-wrapper {
  overflow: hidden;
  border: 1px solid var(--ant-color-border);
  border-radius: 6px;
}
</style>
