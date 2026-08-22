<script lang="ts" setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Button, Tag, Tree, Spin, Empty } from 'ant-design-vue';

import { getChildren, getMemberTree } from './api';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const treeData = ref<any[]>([]);
const expandedKeys = ref<(string | number)[]>([]);

// 是否是从会员列表跳转过来查看某个会员的架构
const focusMemberId = ref(0);
const focusMember = ref<any>(null);

const fmtTime = (v: string) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 将 API 返回的会员转为树节点
function toTreeNode(m: any) {
  return {
    key: m.id,
    ...m,
    isLeaf: m.isLeaf ?? m.directChildCount === 0,
    children: [],
  };
}

// 模式1: 独立入口 -- 加载所有顶级会员（无推荐人），懒加载子级
async function loadRootMembers() {
  loading.value = true;
  try {
    const res: any = await getChildren();
    treeData.value = (res || []).map(toTreeNode);
  } finally {
    loading.value = false;
  }
}

// 模式2: 从会员列表跳转 -- 加载指定会员的全量后代树
async function loadMemberSubTree(memberId: number) {
  loading.value = true;
  try {
    const res: any = await getMemberTree(memberId);
    focusMember.value = res.root;

    // 构建树
    const descendants = res.descendants || [];
    const childrenMap = new Map<number, any[]>();
    for (const d of descendants) {
      const pid = d.parentId ?? 0;
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid)!.push(d);
    }

    function makeNode(item: any): any {
      const kids = childrenMap.get(item.id) || [];
      return {
        key: item.id,
        ...item,
        isLeaf: kids.length === 0 && item.directChildCount === 0,
        children: kids.map(makeNode),
      };
    }

    const rootKids = childrenMap.get(memberId) || [];
    treeData.value = rootKids.map(makeNode);
    expandedKeys.value = rootKids.map((n: any) => n.id);
  } finally {
    loading.value = false;
  }
}

// 懒加载子级（仅模式1 使用）
const onLoadData = (treeNode: any) => {
  return new Promise<void>(async (resolve) => {
    if (treeNode.dataRef.children && treeNode.dataRef.children.length > 0) {
      resolve();
      return;
    }
    const res: any = await getChildren(treeNode.dataRef.id);
    treeNode.dataRef.children = (res || []).map(toTreeNode);
    treeData.value = [...treeData.value];
    resolve();
  });
};

async function init() {
  const id = Number(route.query.id) || 0;
  focusMemberId.value = id;
  if (id > 0) {
    await loadMemberSubTree(id);
  } else {
    await loadRootMembers();
  }
}

onMounted(init);

// 路由参数变化时重新加载（从架构页内部跳转时）
watch(() => route.query.id, () => {
  init();
});

const switchToOverview = () => {
  focusMemberId.value = 0;
  focusMember.value = null;
  router.replace({ name: 'MemberTree' });
  loadRootMembers();
};
</script>

<template>
  <Page auto-content-height>
    <div class="tree-page">
      <!-- 顶部栏 -->
      <div class="tree-header">
        <Button v-if="focusMemberId > 0" @click="switchToOverview">全部会员</Button>
        <span class="tree-title">会员架构</span>
      </div>

      <!-- 指定会员信息卡片（模式2） -->
      <div v-if="focusMember" class="focus-card">
        <div class="focus-card-inner">
          <div class="focus-name">
            {{ focusMember.username }}
            <span class="focus-name-sub">{{ focusMember.name }}</span>
          </div>
          <Tag color="blue">ID: {{ focusMember.id }}</Tag>
          <Tag v-if="focusMember.invitationCode" color="orange">邀请码: {{ focusMember.invitationCode }}</Tag>
          <Tag color="green">直推: {{ focusMember.directChildCount }} 人</Tag>
          <span class="focus-time">注册: {{ fmtTime(focusMember.createTime) }}</span>
        </div>
      </div>

      <!-- 树形结构 -->
      <div class="tree-container">
        <Spin :spinning="loading">
          <template v-if="!loading && treeData.length === 0">
            <Empty description="暂无下级会员" />
          </template>
          <Tree
            v-if="treeData.length > 0"
            v-model:expandedKeys="expandedKeys"
            :tree-data="treeData"
            :load-data="focusMemberId === 0 ? onLoadData : undefined"
            :selectable="false"
            block-node
          >
            <template #title="node">
              <div class="tree-node">
                <span class="node-username">{{ node.username }}</span>
                <span class="node-name">{{ node.name }}</span>
                <Tag
                  :color="node.status === 0 ? 'success' : 'error'"
                  class="node-tag"
                >
                  {{ node.status === 0 ? '正常' : '封禁' }}
                </Tag>
                <span v-if="node.directChildCount > 0" class="node-child-count">
                  ({{ node.directChildCount }}人)
                </span>
                <span class="node-time">{{ fmtTime(node.createTime) }}</span>
                <Button
                  v-if="node.directChildCount > 0"
                  type="link"
                  size="small"
                  class="node-link"
                  @click.stop="router.push({ name: 'MemberTree', query: { id: node.id } })"
                >
                  查看架构
                </Button>
              </div>
            </template>
          </Tree>
        </Spin>
      </div>
    </div>
  </Page>
</template>

<style scoped>
.tree-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
}

.tree-header {
  display: flex;
  flex-shrink: 0;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.tree-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--ant-color-text);
}

.focus-card {
  flex-shrink: 0;
  padding: 16px;
  margin-bottom: 16px;
  background: var(--ant-color-fill-quaternary);
  border: 1px solid var(--ant-color-border);
  border-radius: 8px;
}

.focus-card-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}

.focus-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--ant-color-text);
}

.focus-name-sub {
  margin-left: 4px;
  font-weight: 400;
  color: var(--ant-color-text-quaternary);
}

.focus-time {
  font-size: 12px;
  color: var(--ant-color-text-quaternary);
}

.tree-container {
  flex: 1;
  padding: 16px;
  overflow: auto;
  background: var(--ant-color-bg-container);
  border: 1px solid var(--ant-color-border);
  border-radius: 8px;
}


.tree-node {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
  font-size: 13px;
}

.node-username {
  font-weight: 500;
  color: var(--ant-color-text);
}

.node-name {
  color: var(--ant-color-text-tertiary);
}

.node-tag {
  padding: 0 4px;
  margin: 0;
  font-size: 11px;
  line-height: 18px;
}

.node-child-count {
  font-size: 12px;
  color: var(--ant-color-primary);
}

.node-time {
  font-size: 11px;
  color: var(--ant-color-text-quaternary);
}

.node-link {
  height: auto;
  padding: 0;
  font-size: 12px;
}
</style>

<style>
.tree-container .ant-tree-list-holder-inner > .ant-tree-treenode {
  padding-inline: 4px;
  border-bottom: 1px solid rgb(128 128 128 / 15%);
}

.tree-container .ant-tree-list-holder-inner > .ant-tree-treenode:nth-child(odd) {
  background: rgb(128 128 128 / 6%);
}
</style>
