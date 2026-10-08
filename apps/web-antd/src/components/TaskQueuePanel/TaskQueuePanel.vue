<script lang="ts" setup>
/**
 * TaskQueuePanel —— 右侧常驻任务队列面板（用户 2026-10-06 要求）。
 *
 * ## 用户原话
 *
 * > 「右侧 加入个 任务列表 点击一键7视图 实际上是加入任务列队 可以随时打开查看
 * >   去掉 编辑 等等 并且还可以把其他人物的7视图 也加入任务」
 * > 「右侧面板 是改为全站常驻」
 * > 「任务队列是 一项 一张图」
 * > 「立即执行 提到本组队首（不跨组）」
 *
 * ## 设计要点
 *
 * ① **一项 = 一张图**（一个视图），不是一个任务 —— 用户看到的是「伊丽莎白·正脸」，
 *    展开可见它内部的两个子任务（提示词生成 → 素材出图）。
 *
 * ② **分组显示**：提示词组 / 生图组。这正是**执行顺序** ——
 *    文本组会被先整体跑完，再切模型跑生图组（用户要的"文本和文本一起、图像和图像一起"）。
 *
 * ③ **顺序 = 执行顺序**：列表从上到下就是执行先后。后端 `/Task/List` 对排队中的任务
 *    按 `priority DESC, sort_no ASC` 返回，与领取 SQL 完全一致。
 *    （改之前界面按 `id DESC`，与执行顺序**相反** —— 用户读到的顺序是反的。）
 *
 * ④ **不新增轮询通道**：复用既有 `useTaskStream` 的 queue 订阅 + 低频兜底刷新。
 */
import type { TaskItem } from '#/api/core/dramafloow';

import { computed, onMounted, onUnmounted, ref } from 'vue';

import { IconifyIcon } from '@vben/icons';

import { Button, Empty, Spin, Tag, Tooltip, message } from 'ant-design-vue';

import {
  GPU_GROUP_TYPES,
  taskList,
  taskMove,
  taskRunNow,
} from '#/api/core/dramafloow';
import {
  TASK_STATUS_TEXT,
  TASK_TYPE_TEXT,
  useTaskStream,
} from '#/composables/useTaskStream';
import { taskStatusColor } from '#/composables/useTaskStream';

// 状态/类型 → 中文（与任务列表页同一份映射，避免两处口径漂移）
const typeText = (t: string) => TASK_TYPE_TEXT[t] ?? t;
const taskStatusText = (s: string) => TASK_STATUS_TEXT[s] ?? s;

const collapsed = ref(false);
const loading = ref(false);
const queued = ref<TaskItem[]>([]);
const running = ref<TaskItem[]>([]);
/** 展开查看子任务的组 key */
const expanded = ref<Set<string>>(new Set());

const stream = useTaskStream();

async function load() {
  loading.value = true;
  try {
    // 面板只关心"接下来会跑什么"：排队中 + 正在跑；已完成的不占版面
    const [q, r] = await Promise.all([
      taskList({ page: 1, pageSize: 100, status: 'queued' }),
      taskList({ page: 1, pageSize: 30, status: 'running' }),
    ]);
    queued.value = q?.items ?? [];
    running.value = r?.items ?? [];
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

const isGpu = (t: TaskItem) => GPU_GROUP_TYPES.has(t.type);

/** 一组 = 一个视图（同一 refEntity），即"一张图"。 */
interface ViewGroup {
  gpu: boolean;
  key: string;
  /** 组内代表任务：优先生图任务（那才是用户眼里的"这张图"） */
  lead: TaskItem;
  label: string;
  members: TaskItem[];
  /** 生图任务在等同组前置（用于显示 ⏸） */
  waitingPrereq: boolean;
}

/** 按真实执行顺序比较（与后端领取 SQL 同口径）。 */
const byExecOrder = (a: TaskItem, b: TaskItem) =>
  b.priority - a.priority || (a.sortNo ?? a.id) - (b.sortNo ?? b.id) || a.id - b.id;

const groups = computed<ViewGroup[]>(() => {
  const map = new Map<string, TaskItem[]>();
  for (const t of queued.value) {
    // 无归属的任务各自成组（不与别人混在一起）
    const key =
      t.refEntityType && t.refEntityId
        ? `${t.refEntityType}:${t.refEntityId}`
        : `task:${t.id}`;
    const arr = map.get(key) ?? [];
    arr.push(t);
    map.set(key, arr);
  }

  const out: ViewGroup[] = [];
  for (const [key, members] of map) {
    members.sort(byExecOrder);
    const lead = members.find((m) => isGpu(m)) ?? members[0]!;
    // 生图任务存在、但同组没有已完成的 prompt_gen → 它在等前置
    // （后端有前置门，不会抢跑；这里只是把"为什么还没跑"显示出来）
    const hasText = members.some((m) => !isGpu(m));
    out.push({
      gpu: members.some((m) => isGpu(m)),
      key,
      lead,
      label: lead.target || `${typeText(lead.type)} #${lead.id}`,
      members,
      waitingPrereq: isGpu(lead) && hasText,
    });
  }

  // 提示词组整体在前 —— 那就是执行顺序；组内按执行顺序
  out.sort((a, b) => {
    if (a.gpu !== b.gpu) return a.gpu ? 1 : -1;
    return byExecOrder(a.lead, b.lead);
  });
  return out;
});

const textGroups = computed(() => groups.value.filter((g) => !g.gpu));
const gpuGroups = computed(() => groups.value.filter((g) => g.gpu));

function toggle(key: string) {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
}

/**
 * 立即执行：提到**本组队首**（不跨组 —— 跨组会多一次模型切换，用户已确认）。
 *
 * 后端会回报「现在还在等什么」，如实转达：
 * 只说"已插队"会让"还是没跑"变成无从排查的谜题（用户本次就是这么被卡的）。
 */
async function runNow(t: TaskItem) {
  try {
    const res = await taskRunNow(t.id);
    message.success(
      res?.blockedReason ? `已插队，但${res.blockedReason}` : '已插队',
    );
    await load();
  } catch {
    // 拦截器已提示
  }
}

async function move(t: TaskItem, direction: 'down' | 'up') {
  try {
    await taskMove(t.id, direction);
    await load();
  } catch {
    // 拦截器已提示（含"已经是本组队首/队尾"的可操作指引）
  }
}

let timer: any = null;

onMounted(() => {
  // 队列深度变化由 WebSocket 推送；任务状态流转再加一个低频兜底。
  // 15s 而非 3s：全站常驻面板不需要秒级，避免无谓负载。
  stream.subscribeQueue();
  void load();
  timer = setInterval(() => void load(), 15_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <!-- 收起态：细边 + 角标（不遮主内容） -->
  <div v-if="collapsed" class="tqp-rail" @click="collapsed = false">
    <IconifyIcon icon="lucide:list-ordered" class="size-4" />
    <span v-if="queued.length" class="tqp-badge">{{ queued.length }}</span>
  </div>

  <div v-else class="tqp">
    <div class="tqp-head">
      <span class="tqp-title">
        任务队列
        <span class="tqp-sub">
          排队 {{ queued.length }} · 在跑 {{ running.length }}
        </span>
      </span>
      <Button type="text" size="small" @click="collapsed = true">
        <IconifyIcon icon="lucide:chevron-right" class="size-4" />
      </Button>
    </div>

    <div class="tqp-body">
      <Spin :spinning="loading" size="small">
        <div v-if="running.length" class="tqp-sect">
          <div class="tqp-sect-title">正在执行</div>
          <div v-for="t in running" :key="t.id" class="tqp-row">
            <span class="tqp-name">{{ t.target || `#${t.id}` }}</span>
            <Tag :color="taskStatusColor(t.status)">
              {{ taskStatusText(t.status) }}
            </Tag>
            <span class="tqp-prog">{{ t.progress }}%</span>
          </div>
        </div>

        <Empty
          v-if="groups.length === 0"
          :image="Empty.PRESENTED_IMAGE_SIMPLE"
          description="队列为空"
        />

        <!-- 提示词组（会先整体跑完） -->
        <div v-if="textGroups.length" class="tqp-sect">
          <div class="tqp-sect-title">
            提示词组（{{ textGroups.length }}）
            <Tooltip
              title="这一组会先整体跑完，再切换模型去跑生图组 —— 减少模型来回切换"
            >
              <IconifyIcon icon="lucide:info" class="tqp-info" />
            </Tooltip>
          </div>
          <div v-for="g in textGroups" :key="g.key" class="tqp-item">
            <div class="tqp-row">
              <Button
                class="tqp-caret"
                size="small"
                type="text"
                @click="toggle(g.key)"
              >
                <IconifyIcon
                  :icon="
                    expanded.has(g.key)
                      ? 'lucide:chevron-down'
                      : 'lucide:chevron-right'
                  "
                  class="size-3.5"
                />
              </Button>
              <span class="tqp-name" @click="toggle(g.key)">{{ g.label }}</span>
              <span class="tqp-ops">
                <Tooltip title="立即执行（提到本组队首）">
                  <Button size="small" type="text" @click="runNow(g.lead)">
                    <IconifyIcon icon="lucide:zap" class="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip title="上移">
                  <Button size="small" type="text" @click="move(g.lead, 'up')">
                    <IconifyIcon icon="lucide:arrow-up" class="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip title="下移">
                  <Button size="small" type="text" @click="move(g.lead, 'down')">
                    <IconifyIcon icon="lucide:arrow-down" class="size-3.5" />
                  </Button>
                </Tooltip>
              </span>
            </div>
            <!-- 展开：该视图的两个子任务（一项 = 一张图，内部两阶段） -->
            <div v-if="expanded.has(g.key)" class="tqp-sub-list">
              <div v-for="m in g.members" :key="m.id" class="tqp-sub-row">
                <span class="tqp-sub-type">{{ typeText(m.type) }}</span>
                <Tag :color="taskStatusColor(m.status)">
                  {{ taskStatusText(m.status) }}
                </Tag>
                <span class="tqp-sub-id">#{{ m.id }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 生图组 -->
        <div v-if="gpuGroups.length" class="tqp-sect">
          <div class="tqp-sect-title">生图组（{{ gpuGroups.length }}）</div>
          <div v-for="g in gpuGroups" :key="g.key" class="tqp-item">
            <div class="tqp-row">
              <Button
                class="tqp-caret"
                size="small"
                type="text"
                @click="toggle(g.key)"
              >
                <IconifyIcon
                  :icon="
                    expanded.has(g.key)
                      ? 'lucide:chevron-down'
                      : 'lucide:chevron-right'
                  "
                  class="size-3.5"
                />
              </Button>
              <span class="tqp-name" @click="toggle(g.key)">{{ g.label }}</span>
              <Tooltip
                v-if="g.waitingPrereq"
                title="等待前置提示词生成完成（不会抢跑，跑完提示词会自动开始）"
              >
                <IconifyIcon icon="lucide:pause-circle" class="tqp-wait" />
              </Tooltip>
              <span class="tqp-ops">
                <Tooltip title="立即执行（提到本组队首）">
                  <Button size="small" type="text" @click="runNow(g.lead)">
                    <IconifyIcon icon="lucide:zap" class="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip title="上移">
                  <Button size="small" type="text" @click="move(g.lead, 'up')">
                    <IconifyIcon icon="lucide:arrow-up" class="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip title="下移">
                  <Button size="small" type="text" @click="move(g.lead, 'down')">
                    <IconifyIcon icon="lucide:arrow-down" class="size-3.5" />
                  </Button>
                </Tooltip>
              </span>
            </div>
            <div v-if="expanded.has(g.key)" class="tqp-sub-list">
              <div v-for="m in g.members" :key="m.id" class="tqp-sub-row">
                <span class="tqp-sub-type">{{ typeText(m.type) }}</span>
                <Tag :color="taskStatusColor(m.status)">
                  {{ taskStatusText(m.status) }}
                </Tag>
                <span class="tqp-sub-id">#{{ m.id }}</span>
              </div>
            </div>
          </div>
        </div>
      </Spin>
    </div>
  </div>
</template>

<style scoped>
.tqp {
  display: flex;
  flex-direction: column;
  width: 280px;
  height: 100%;
  background: hsl(var(--background));
  border-left: 1px solid hsl(var(--border));
}

.tqp-rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  padding: 10px 6px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  border-left: 1px solid hsl(var(--border));
}

.tqp-rail:hover {
  color: hsl(var(--foreground));
}

.tqp-badge {
  padding: 0 4px;
  font-size: 11px;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  border-radius: 8px;
}

.tqp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid hsl(var(--border));
}

.tqp-title {
  font-size: 13px;
  font-weight: 600;
}

.tqp-sub {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: hsl(var(--muted-foreground));
}

.tqp-body {
  flex: 1;
  padding: 8px 6px;
  overflow-y: auto;
}

.tqp-sect {
  margin-bottom: 10px;
}

.tqp-sect-title {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 4px 6px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

.tqp-info {
  cursor: help;
}

.tqp-item {
  margin-bottom: 2px;
}

.tqp-row {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 2px 4px;
  border-radius: 4px;
}

.tqp-row:hover {
  background: hsl(var(--accent));
}

.tqp-caret {
  height: 18px;
  padding: 0;
}

.tqp-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  white-space: nowrap;
}

.tqp-ops {
  display: none;
  gap: 0;
}

.tqp-row:hover .tqp-ops {
  display: flex;
}

.tqp-prog {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

.tqp-wait {
  color: hsl(var(--muted-foreground));
}

.tqp-sub-list {
  padding: 2px 0 4px 22px;
}

.tqp-sub-row {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

.tqp-sub-type {
  min-width: 62px;
}

.tqp-sub-id {
  font-family: monospace;
}
</style>
