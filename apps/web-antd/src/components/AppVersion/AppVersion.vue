<script lang="ts" setup>
import { computed } from 'vue';

interface Props {
  /** 完整 version 字符串，形如 "1.0.41+abc123..."（一般来自 /admin/App/Info 的 version 字段） */
  value?: null | string;
  /** 显示哪部分：full=两行 / version=只版本号 / commit=只 commit sha，默认 full */
  show?: 'commit' | 'full' | 'version';
  /** commit sha 截短到前 N 位，0 表示不截短，默认 0（全显） */
  shortCommit?: number;
  /** 占位符，当 value 空或被请求的段为空时显示，默认 — */
  placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
  value: '',
  show: 'full',
  shortCommit: 0,
  placeholder: '—',
});

const versionPart = computed(() => {
  const v = props.value || '';
  const i = v.indexOf('+');
  return i > 0 ? v.slice(0, i) : v;
});

const commitPart = computed(() => {
  const v = props.value || '';
  const i = v.indexOf('+');
  let c = i > 0 ? v.slice(i + 1) : '';
  if (props.shortCommit > 0 && c.length > props.shortCommit)
    c = c.slice(0, props.shortCommit);
  return c;
});
</script>

<template>
  <span v-if="show === 'version'" class="app-version__version">
    {{ versionPart || placeholder }}
  </span>
  <span v-else-if="show === 'commit'" class="app-version__commit">
    {{ commitPart || placeholder }}
  </span>
  <span v-else class="app-version__full">
    <span class="app-version__version">{{ versionPart || placeholder }}</span>
    <span v-if="commitPart" class="app-version__commit">{{ commitPart }}</span>
  </span>
</template>

<style scoped>
.app-version__full {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.3;
}
.app-version__commit {
  font-size: 12px;
  color: var(--ant-color-text-tertiary);
  font-family: Menlo, Consolas, monospace;
  word-break: break-all;
}
</style>
