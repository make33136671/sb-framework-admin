/**
 * useTaskStream —— 实时任务流（契约 §5.3）
 *
 * 职责：
 * - 与 /api/TaskStream/Stream 建立 WebSocket（握手用 ?access_token=，框架 JwtSetup 支持）
 * - 按 topic 订阅：task:<id> / queue / health / drama:<id>
 * - 断线自动重连（指数退避，上限 30s），重连后按 topic 重新 subscribe（协议要求）
 * - 状态进 Pinia store，组件响应式读取
 *
 * 用法：
 *   const stream = useTaskStream();
 *   stream.subscribeTask(123);
 *   // store.queue / store.taskMap / store.health / store.dramaMap 响应式
 */
import { computed, onScopeDispose, ref } from 'vue';

import { useAccessStore } from '@vben/stores';

import { defineStore } from 'pinia';

// ─────────────────────────── 消息类型（与后端一致） ───────────────────────────

export interface TaskEvent {
  op: 'task';
  id: number;
  type: string;
  dramaId: number;
  status: string;
  progress: number;
  version: number;
  currentVariant: number;
  refEntityType?: string;
  refEntityId?: number;
  message?: string;
  error?: string;
  ts: string;
}

export interface QueueEvent {
  op: 'queue';
  depth: number;
  inFlightT2i: number;
  inFlightI2v: number;
  paused: boolean;
  reason?: string;
  windowOpen: boolean;
  window: string;
  ts: string;
}

export interface HealthEvent {
  op: 'health';
  api: string;
  comfyui: string;
  llm?: string;
  /** 契约 §7 /healthz 四探活：数据库与 n8n（面板 A 区展示，设计 §A「待补」） */
  db?: string;
  n8n?: string;
  comfyuiBase?: string;
  lastBeat: string;
}

export interface DramaEvent {
  op: 'drama';
  id: number;
  name: string;
  status: string;
  stages: Record<string, string>;
  /**
   * 五横向（横向结构 P1，灰度双下发）：key ∈ analyze/rewrite/extract/episodes/produce。
   * 可选 —— 后端在灰度期同时下发；前端**优先读它**，缺失时才回落 `stages`
   * （旧 5 键语义已错：把洗稿放第一位、缺「分析」「抽取」「分集」三个横向）。
   */
  stagesV2?: Record<string, string>;
  ts: string;
}

type WsMessage =
  | DramaEvent
  | HealthEvent
  | QueueEvent
  | TaskEvent
  | { op: string; ts?: string };

// ─────────────────────────── Pinia store ───────────────────────────

export const useTaskStreamStore = defineStore('dramafloow-task-stream', () => {
  const connected = ref(false);
  const lastMessageAt = ref<string>('');
  const taskMap = ref<Record<number, TaskEvent>>({});
  const dramaMap = ref<Record<number, DramaEvent>>({});
  const queue = ref<null | QueueEvent>(null);
  const health = ref<HealthEvent | null>(null);

  function applyTask(e: TaskEvent) {
    taskMap.value = { ...taskMap.value, [e.id]: e };
  }

  function applyDrama(e: DramaEvent) {
    dramaMap.value = { ...dramaMap.value, [e.id]: e };
  }

  function applyQueue(e: QueueEvent) {
    queue.value = e;
  }

  function applyHealth(e: HealthEvent) {
    health.value = e;
  }

  function reset() {
    connected.value = false;
    taskMap.value = {};
    dramaMap.value = {};
    queue.value = null;
    health.value = null;
  }

  return {
    connected,
    lastMessageAt,
    taskMap,
    dramaMap,
    queue,
    health,
    applyTask,
    applyDrama,
    applyQueue,
    applyHealth,
    reset,
  };
});

// 模块级单例：多个组件共享同一条 WS，避免重复连接
let socket: null | WebSocket = null;
let reconnectTimer: null | ReturnType<typeof setTimeout> = null;
let reconnectDelay = 1000;
const topicSet = new Set<string>();
const subscriberCount = ref(0);

function wsUrl(): string {
  const accessStore = useAccessStore();
  const token = accessStore.accessToken ?? '';
  // 开发态走 vite 代理同源；生产由 nginx 反代 /api
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${proto}//${window.location.host}/api/TaskStream/Stream`;
  return token ? `${base}?access_token=${encodeURIComponent(token)}` : base;
}

function sendSubscribe() {
  if (socket?.readyState !== WebSocket.OPEN || topicSet.size === 0) return;
  socket.send(JSON.stringify({ op: 'subscribe', topics: [...topicSet] }));
}

function connect() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const store = useTaskStreamStore();
  try {
    socket = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  socket.addEventListener('open', () => {
    store.connected = true;
    reconnectDelay = 1000;
    sendSubscribe();
  });

  socket.addEventListener('message', (ev) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(ev.data as string) as WsMessage;
    } catch {
      return;
    }
    store.lastMessageAt = new Date().toISOString();

    switch (msg.op) {
      case 'drama': {
        store.applyDrama(msg as DramaEvent);
        break;
      }
      case 'health': {
        store.applyHealth(msg as HealthEvent);
        break;
      }
      case 'pong': {
        break;
      }
      case 'queue': {
        store.applyQueue(msg as QueueEvent);
        break;
      }
      case 'task': {
        store.applyTask(msg as TaskEvent);
        break;
      }
      default: {
        break;
      }
    }
  });

  socket.addEventListener('close', () => {
    store.connected = false;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // close 事件会紧随其后，重连逻辑统一放 close
    store.connected = false;
  });
}

function scheduleReconnect() {
  if (reconnectTimer || subscriberCount.value === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
}

function ensureConnected() {
  subscriberCount.value += 1;
  connect();
}

function maybeDisconnect() {
  subscriberCount.value = Math.max(0, subscriberCount.value - 1);
  if (subscriberCount.value > 0) return;
  // 无订阅者：断开并清理，避免后台空跑
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
  topicSet.clear();
  useTaskStreamStore().reset();
}

// ─────────────────────────── 对外 composable ───────────────────────────

export function useTaskStream() {
  const store = useTaskStreamStore();
  ensureConnected();

  onScopeDispose(() => {
    maybeDisconnect();
  });

  function addTopic(t: string) {
    const isNew = !topicSet.has(t);
    topicSet.add(t);
    if (isNew) sendSubscribe();
  }

  function removeTopic(t: string) {
    topicSet.delete(t);
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ op: 'unsubscribe', topics: [t] }));
    }
  }

  /** 始终订阅队列与健康（首屏即需要） */
  addTopic('queue');
  addTopic('health');

  return {
    store,
    connected: computed(() => store.connected),
    queue: computed(() => store.queue),
    health: computed(() => store.health),
    taskMap: computed(() => store.taskMap),
    dramaMap: computed(() => store.dramaMap),
    subscribeQueue: () => addTopic('queue'),
    subscribeHealth: () => addTopic('health'),
    subscribeTask: (id: number) => addTopic(`task:${id}`),
    unsubscribeTask: (id: number) => removeTopic(`task:${id}`),
    subscribeDrama: (id: number) => addTopic(`drama:${id}`),
    unsubscribeDrama: (id: number) => removeTopic(`drama:${id}`),
    taskOf: (id: number) => computed(() => store.taskMap[id]),
    dramaOf: (id: number) => computed(() => store.dramaMap[id]),
  };
}

/** 任务状态 → antd Tag 颜色（沿用 preset 名，禁硬编码色值） */
export function taskStatusColor(status: string): string {
  switch (status) {
    case 'approved':
    case 'done': {
      return 'success';
    }
    case 'collecting':
    case 'generating': {
      return 'processing';
    }
    case 'failed':
    case 'rejected': {
      return 'error';
    }
    case 'pending_review': {
      return 'warning';
    }
    case 'preparing':
    case 'queued': {
      return 'default';
    }
    default: {
      return 'default';
    }
  }
}

// 任务状态/类型的中文名已迁到 **useEnumText.ts**（全站唯一事实源，含全部业务枚举）。
// 此处保留再导出，兼容既有 `import { TASK_STATUS_TEXT } from '#/composables/useTaskStream'` 的写法。
// 新增类型时只改 useEnumText.ts 一处。
export { TASK_STATUS_TEXT, TASK_TYPE_TEXT } from './useEnumText';
