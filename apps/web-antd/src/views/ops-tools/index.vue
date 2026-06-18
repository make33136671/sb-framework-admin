<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Tabs } from 'ant-design-vue';

import AppSettingsView from '../app-settings/index.vue';
import CacheList from '../cache/List.vue';
import DatabaseList from '../database/List.vue';
import SqlList from '../sql/List.vue';

const route = useRoute();
const router = useRouter();

/** 合法 tab key 列表，URL ?tab= 校验用 */
const TAB_KEYS = ['backup', 'cache', 'sql', 'app-settings'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const initialTab = computed<TabKey>(() => {
  const q = route.query.tab as string | undefined;
  return TAB_KEYS.includes(q as TabKey) ? (q as TabKey) : 'backup';
});

const activeKey = ref<TabKey>(initialTab.value);

// URL 同步：切 Tab 时更新 query；外部带 tab 参数进来也响应
watch(activeKey, (val) => {
  if (route.query.tab !== val) {
    router.replace({ query: { ...route.query, tab: val } });
  }
});

watch(
  () => route.query.tab,
  (val) => {
    if (TAB_KEYS.includes(val as TabKey) && val !== activeKey.value) {
      activeKey.value = val as TabKey;
    }
  },
);
</script>

<template>
  <Page auto-content-height>
    <Tabs v-model:active-key="activeKey" class="ops-tabs" :animated="false">
      <Tabs.TabPane key="backup" tab="数据库备份">
        <DatabaseList />
      </Tabs.TabPane>
      <Tabs.TabPane key="cache" tab="缓存管理">
        <CacheList />
      </Tabs.TabPane>
      <Tabs.TabPane key="sql" tab="SQL 执行">
        <SqlList />
      </Tabs.TabPane>
      <Tabs.TabPane key="app-settings" tab="配置文件">
        <AppSettingsView />
      </Tabs.TabPane>
    </Tabs>
  </Page>
</template>

<style scoped>
/* Page → Tabs → TabPane → 子组件 高度链路要全部撑满，
 * 否则 vxe-grid 的 height:'auto' 会自己无限撑开（数据库备份 Tab 之前
 * 表格越来越长就是断在这里）*/
.ops-tabs {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.ops-tabs :deep(.ant-tabs-content-holder) {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.ops-tabs :deep(.ant-tabs-content) {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.ops-tabs :deep(.ant-tabs-tabpane) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* tabpane 的直接子组件也要撑满（database List 用了 .db-tab 类） */
.ops-tabs :deep(.ant-tabs-tabpane) > * {
  flex: 1;
  min-height: 0;
}
</style>
