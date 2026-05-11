<script lang="ts" setup>
import type { WorkbenchQuickNavItem } from '@vben/common-ui';

import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  WorkbenchHeader,
  WorkbenchQuickNav,
} from '@vben/common-ui';
import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';

import { Card, Tag, Table, Statistic, Spin } from 'ant-design-vue';

import {
  getOverview,
  getRecentLogins,
  getRecentMembers,
  getPendingRealNames,
} from '../api';

const router = useRouter();
const userStore = useUserStore();

const loading = ref(true);
const overview = ref<any>({});
const recentLogins = ref<any[]>([]);
const recentMembers = ref<any[]>([]);
const pendingRealNames = ref<any[]>([]);

const fmtTime = (v: string) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

onMounted(async () => {
  const [o, logins, members, realNames] = await Promise.all([
    getOverview(),
    getRecentLogins(8),
    getRecentMembers(8),
    getPendingRealNames(5),
  ]);
  overview.value = o || {};
  recentLogins.value = (logins as any) || [];
  recentMembers.value = (members as any) || [];
  pendingRealNames.value = (realNames as any) || [];
  loading.value = false;
});

const quickNavItems: WorkbenchQuickNavItem[] = [
  { color: '#1890ff', icon: 'lucide:users', title: '会员管理', url: '/member/list' },
  { color: '#52c41a', icon: 'lucide:git-branch', title: '会员架构', url: '/member/tree' },
  { color: '#faad14', icon: 'lucide:shield-check', title: '实名审核', url: '/member/real-name' },
  { color: '#722ed1', icon: 'lucide:settings', title: '系统设置', url: '/system/setting' },
  { color: '#13c2c2', icon: 'lucide:mail', title: '邮件配置', url: '/email/config' },
  { color: '#eb2f96', icon: 'lucide:activity', title: '登录日志', url: '/system/devtools/login-log' },
];

function navTo(nav: WorkbenchQuickNavItem) {
  if (nav.url?.startsWith('/')) {
    router.push(nav.url);
  }
}

const loginColumns = [
  { title: '用户名', dataIndex: 'username', width: 120 },
  { title: '类型', dataIndex: 'userType', width: 70, customRender: ({ text }: any) => text === 0 ? '会员' : '管理员' },
  { title: 'IP', dataIndex: 'ipAddress', width: 130 },
  { title: '状态', dataIndex: 'status', width: 70 },
  { title: '时间', dataIndex: 'createTime', width: 120 },
];

const memberColumns = [
  { title: '用户名', dataIndex: 'username', width: 120 },
  { title: '名称', dataIndex: 'name', width: 100 },
  { title: '状态', dataIndex: 'status', width: 70 },
  { title: '注册时间', dataIndex: 'createdTime', width: 120 },
];
</script>

<template>
  <div class="p-5">
    <WorkbenchHeader
      :avatar="userStore.userInfo?.avatar || preferences.app.defaultAvatar"
    >
      <template #title>
        早安, {{ userStore.userInfo?.realName }}, 开始您一天的工作吧！
      </template>
      <template #description>
        当前共有 {{ overview.totalMembers ?? '-' }} 位会员，
        今日新增 {{ overview.todayNewMembers ?? 0 }} 人，
        {{ overview.pendingReviewCount ?? 0 }} 条实名认证待审核
      </template>
    </WorkbenchHeader>

    <Spin :spinning="loading">
      <!-- 统计卡片 -->
      <div class="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <Statistic title="总会员数" :value="overview.totalMembers ?? 0" />
        </Card>
        <Card>
          <Statistic title="今日新增" :value="overview.todayNewMembers ?? 0" suffix="人" :value-style="{ color: '#1890ff' }" />
        </Card>
        <Card>
          <Statistic title="今日活跃" :value="overview.todayLogins ?? 0" suffix="人" :value-style="{ color: '#52c41a' }" />
        </Card>
        <Card>
          <Statistic title="待审核实名" :value="overview.pendingReviewCount ?? 0" suffix="条" :value-style="overview.pendingReviewCount > 0 ? { color: '#faad14' } : {}" />
        </Card>
      </div>

      <div class="mt-5 flex flex-col lg:flex-row">
        <!-- 左侧 -->
        <div class="mr-4 w-full lg:w-3/5">
          <!-- 快捷导航 -->
          <WorkbenchQuickNav
            :items="quickNavItems"
            title="快捷导航"
            @click="navTo"
          />

          <!-- 最近登录 -->
          <Card title="最近登录" class="mt-4" :body-style="{ padding: '0' }">
            <Table
              :data-source="recentLogins"
              :columns="loginColumns"
              :pagination="false"
              size="small"
              row-key="createTime"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.dataIndex === 'status'">
                  <Tag :color="record.status === 0 ? 'success' : 'error'" style="margin: 0;">
                    {{ record.status === 0 ? '成功' : '失败' }}
                  </Tag>
                </template>
                <template v-if="column.dataIndex === 'userType'">
                  <Tag :color="record.userType === 0 ? 'blue' : 'purple'" style="margin: 0;">
                    {{ record.userType === 0 ? '会员' : '管理员' }}
                  </Tag>
                </template>
                <template v-if="column.dataIndex === 'createTime'">
                  {{ fmtTime(record.createTime) }}
                </template>
              </template>
            </Table>
          </Card>
        </div>

        <!-- 右侧 -->
        <div class="w-full lg:w-2/5">
          <!-- 待审核实名 -->
          <Card title="待审核实名认证" class="mt-4 lg:mt-0">
            <template v-if="pendingRealNames.length === 0">
              <div style="color: #999; text-align: center; padding: 16px;">暂无待审核</div>
            </template>
            <div v-for="item in pendingRealNames" :key="item.id" class="pending-item">
              <div class="pending-info">
                <span class="pending-name">{{ item.memberUsername }}</span>
                <span class="pending-real">{{ item.realName }}</span>
              </div>
              <span class="pending-time">{{ fmtTime(item.submitTime) }}</span>
            </div>
            <a v-if="pendingRealNames.length > 0" class="view-all" @click="router.push('/member/real-name')">
              查看全部 →
            </a>
          </Card>

          <!-- 最近注册 -->
          <Card title="最近注册会员" class="mt-4">
            <div v-for="item in recentMembers" :key="item.id" class="member-item">
              <div class="member-info">
                <span class="member-username">{{ item.username }}</span>
                <span class="member-name">{{ item.name }}</span>
              </div>
              <div class="member-meta">
                <Tag :color="item.status === 'Active' ? 'success' : 'error'" style="margin: 0; font-size: 11px;">
                  {{ item.status === 'Active' ? '正常' : '封禁' }}
                </Tag>
                <span class="member-time">{{ fmtTime(item.createdTime) }}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Spin>
  </div>
</template>

<style scoped>
.pending-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
}

.pending-item:last-child {
  border-bottom: none;
}

.pending-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pending-name {
  font-weight: 500;
}

.pending-real {
  color: #999;
  font-size: 12px;
}

.pending-time {
  color: #999;
  font-size: 12px;
}

.view-all {
  display: block;
  text-align: center;
  padding-top: 12px;
  color: #1890ff;
  cursor: pointer;
  font-size: 13px;
}

.member-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}

.member-item:last-child {
  border-bottom: none;
}

.member-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.member-username {
  font-weight: 500;
}

.member-name {
  color: #999;
  font-size: 12px;
}

.member-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.member-time {
  color: #999;
  font-size: 12px;
}
</style>
