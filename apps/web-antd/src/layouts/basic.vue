<script lang="ts" setup>
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';

import { AuthenticationLoginExpiredModal } from '@vben/common-ui';
import { useWatermark } from '@vben/hooks';
import { BasicLayout, LockScreen, UserDropdown } from '@vben/layouts';
import { preferences } from '@vben/preferences';
import { useAccessStore, useUserStore } from '@vben/stores';

import { $t } from '#/locales';
import { useAuthStore } from '#/store';
import LoginForm from '#/views/_core/authentication/login.vue';
// 右侧常驻任务队列（用户 2026-10-06：「右侧面板 是改为全站常驻」）。
// ⚠️ 必须**显式 import**：仅写 `<TaskQueuePanel />` 会被编译成
//    resolveComponent('TaskQueuePanel') 的字符串查找，运行时找不到 → 面板静默不渲染
//    （构建不报错，产物里只有一个字符串引用，极难发现）。
import TaskQueuePanel from '#/components/TaskQueuePanel/TaskQueuePanel.vue';

const router = useRouter();
const userStore = useUserStore();
const authStore = useAuthStore();
const accessStore = useAccessStore();
const { destroyWatermark, updateWatermark } = useWatermark();

const menus = computed(() => [
  {
    handler: () => {
      router.push({ name: 'Profile' });
    },
    icon: 'lucide:user',
    text: $t('page.auth.profile'),
  },
]);

const avatar = computed(() => {
  return userStore.userInfo?.avatar ?? preferences.app.defaultAvatar;
});

async function handleLogout() {
  await authStore.logout(false);
}

watch(
  () => ({
    enable: preferences.app.watermark,
    content: preferences.app.watermarkContent,
  }),
  async ({ enable, content }) => {
    if (enable) {
      await updateWatermark({
        content:
          content ||
          `${userStore.userInfo?.username} - ${userStore.userInfo?.realName}`,
      });
    } else {
      destroyWatermark();
    }
  },
  {
    immediate: true,
  },
);
</script>

<template>
  <BasicLayout @clear-preferences-and-logout="handleLogout">
    <template #user-dropdown>
      <UserDropdown
        :avatar="avatar"
        :menus
        :text="userStore.userInfo?.realName"
        :description="userStore.userInfo?.username"
        :tag-text="(userStore.userInfo as any)?.roleName || ''"
        @logout="handleLogout"
        @profile="router.push({ name: 'Profile' })"
      />
    </template>
    <!-- TODO: 站内信功能开发后启用通知铃铛 -->
    <!-- <template #notification>
      <Notification
        :dot="showDot"
        :notifications="notifications"
        @clear="handleNoticeClear"
        @read="(item) => item.id && markRead(item.id)"
        @remove="(item) => item.id && remove(item.id)"
        @make-all="handleMakeAll"
      />
    </template> -->
    <template #extra>
      <AuthenticationLoginExpiredModal
        v-model:open="accessStore.loginExpired"
        :avatar
      >
        <LoginForm />
      </AuthenticationLoginExpiredModal>
    </template>
    <template #lock-screen>
      <LockScreen :avatar @to-login="handleLogout" />
    </template>
    <!--
      右侧常驻任务队列（用户 2026-10-06：「右侧面板 是改为全站常驻」）。

      经由框架的 `content-extra` slot 与主内容并排 → 跨路由**不重建**，
      展开态与滚动位置不会因切页丢失。用并排而非浮层：
      任务队列是"一直要看"的信息，浮层会遮内容且容易误关。
    -->
    <template #content-extra>
      <TaskQueuePanel />
    </template>
  </BasicLayout>
</template>
