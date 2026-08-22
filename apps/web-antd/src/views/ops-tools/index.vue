<script lang="ts" setup>
import { ref } from 'vue';
import { useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Tabs } from 'ant-design-vue';

import AppSettingsView from '../app-settings/index.vue';
import CacheList from '../cache/List.vue';
import DatabaseList from '../database/List.vue';
import SqlList from '../sql/List.vue';

const route = useRoute();

/** 合法 tab key 列表，URL ?tab= 仅用于进入时定位初始 Tab */
const TAB_KEYS = ['backup', 'cache', 'sql', 'app-settings'] as const;
type TabKey = (typeof TAB_KEYS)[number];

/**
 * activeKey 是纯组件内 UI 状态，不再与 URL query 双向联动。
 *
 * 之前的实现：切 Tab → router.replace 改 query，再用第二个 watch 把 query 写回
 * activeKey，形成回环。query 变化会改变路由 fullPath，触发 RouterView keep-alive
 * 缓存键 / 页面实例重建 → 整页重渲染 → 切 Tab 时肉眼可见的刷新闪烁。
 *
 * 现在：进入页面时一次性读取 ?tab= 作为初始 Tab（深链仍可用），之后切 Tab 只改
 * 本地 state，完全不碰路由，从根上消除闪烁。
 */
function resolveInitialTab(): TabKey {
  const q = route.query.tab as string | undefined;
  return TAB_KEYS.includes(q as TabKey) ? (q as TabKey) : 'backup';
}

const activeKey = ref<TabKey>(resolveInitialTab());
</script>

<template>
  <Page auto-content-height>
    <Tabs
      v-model:active-key="activeKey"
      class="ops-tabs"
      :animated="false"
      :destroy-inactive-tab-pane="false"
    >
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
 * 表格越来越长就是断在这里） */
.ops-tabs {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.ops-tabs :deep(.ant-tabs-content-holder) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
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
