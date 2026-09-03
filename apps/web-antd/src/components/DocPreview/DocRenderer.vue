<script lang="ts" setup>
import { computed } from 'vue';

import { usePreferences } from '@vben/preferences';

import { Descriptions, DescriptionsItem } from 'ant-design-vue';
import { MdPreview } from 'md-editor-v3';

import 'md-editor-v3/lib/preview.css';

/**
 * Markdown 文档渲染器(基座通用)
 *
 * 输入 `content`:markdown 文本。组件自动解析顶部 `| key | value |` 表格作为元信息,
 * 提取 `## <descLabel>` 之后的内容作为正文。两段都没有时直接 fallback 整段渲染。
 *
 * `descLabel` 用于:
 *   1. 在 markdown 里找 `## <descLabel>` 提取正文(例如 "需求描述" / "任务描述" / "文档说明")
 *   2. 渲染时显示在描述区域上方作为标题
 *
 * 派生项目通过 `descLabel` 适配自己业务(默认 "描述")。
 */
const props = withDefaults(
  defineProps<{
    content: string;
    descLabel?: string;
  }>(),
  {
    descLabel: '描述',
  },
);

const { isDark } = usePreferences();
const mdTheme = computed(() => (isDark.value ? 'dark' : 'light'));

// 解析基本信息表格
const meta = computed(() => {
  const lines = props.content.split('\n');
  const result: { key: string; value: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (m && m[1] !== '属性' && m[1] !== '---') {
      result.push({ key: m[1]!.trim(), value: m[2]!.trim() });
    }
  }
  return result;
});

// 提取描述内容(## <descLabel> 之后)
const descContent = computed(() => {
  const pattern = new RegExp(String.raw`##\s*${props.descLabel}\s*\n([\s\S]*)$`);
  const match = props.content.match(pattern);
  return match ? match[1]!.trim() : '';
});
</script>

<template>
  <div class="doc-renderer">
    <!-- 基本信息 -->
    <Descriptions
      v-if="meta.length > 0"
      bordered
      size="small"
      :column="3"
      class="doc-renderer-meta"
    >
      <DescriptionsItem v-for="item in meta" :key="item.key" :label="item.key">
        {{ item.value }}
      </DescriptionsItem>
    </Descriptions>

    <!-- 描述内容 -->
    <div v-if="descContent" class="doc-renderer-desc">
      <div class="doc-renderer-desc-label">{{ descLabel }}</div>
      <div class="doc-renderer-desc-body" :class="{ dark: isDark }">
        <MdPreview :model-value="descContent" :theme="mdTheme" />
      </div>
    </div>

    <!-- 无法解析时,直接渲染全部 -->
    <div
      v-else-if="meta.length === 0"
      class="doc-renderer-desc-body"
      :class="{ dark: isDark }"
    >
      <MdPreview :model-value="content || '暂无内容'" :theme="mdTheme" />
    </div>
  </div>
</template>

<style scoped>
.doc-renderer-meta {
  margin-bottom: 16px;
}

.doc-renderer-desc {
  margin-top: 4px;
}

.doc-renderer-desc-label {
  padding-left: 2px;
  margin-bottom: 8px;
  font-size: 15px;
  font-weight: 600;
}

.doc-renderer-desc-body {
  background: var(--ant-color-fill-tertiary);
  border: 1px solid var(--ant-color-border-secondary);
  border-radius: 8px;
}
</style>
