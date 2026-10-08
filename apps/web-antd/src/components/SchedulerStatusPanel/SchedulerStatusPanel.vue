<script lang="ts" setup>
import type { SchedLiveView } from '#/api/core/scheduler';

/**
 * SchedulerStatusPanel —— AI 任务页的「调度器状态」面板（用户 2026-10-07 要求）
 *
 * > 「在 AI 任务页面 加入一个 调度器状态 我需要知道每一台机器 现在在干嘛、
 * >   调度器在干嘛。如果有任务在排队 我要能从状态里看出来 他卡在哪了」
 *
 * ## 节奏（2026-10-07，用户两次调整后定为 500ms）
 *
 * | 层 | 频率 | 作用 |
 * |---|---|---|
 * | 本面板取数 + 进度条步进 | **500ms**（用户指定） | 读内存缓存，不查业务表 |
 * | 后端缓存写入 | **5 秒**（编排器 tick） | 真正的"心跳" |
 * | 数据库审计 | 10 分钟/条（不变） | "历史发生过什么" |
 *
 * 500ms 读的是内存缓存，不增加任何库压力。
 *
 * ## 心跳倒计时条（用户明确要求的效果）
 *
 * > 「如果调度器的状态是一个卡片 那么我希望 有一个会滚动的边框 一直向前滚
 * >   然后数据刷新了 那么滚动归零 继续滚」
 * > 「我指的1圈是 10秒 …进到2000毫秒 就重置为0 了 代表心跳正常
 * >   如果 一直到 10秒 还没重置 就是 死了 超时了」
 *
 * 语义：**进度 = 距上次心跳的时间 / 10 秒**，由 500ms 时钟推进。
 *   · 心跳正常（每 5 秒一次）→ 进度只长到 ~50% 就归零 → 看得见的重置
 *   · 编排器停了 → 一路长满 → 变红 → 一眼看出死了
 *
 * ⚠️ 实现**不用** CSS animation，也**不用**渐变 + CSS 变量 ——
 *    前者会"一跳一跳"，后者在 Chromium 下**完全不重绘**（静默失效）。
 *    最终用普通 div 的 **width**（布局属性变化必然重绘）。详见 CSS 里的四版对比表。
 *    改为按数据年龄直接算角度，天然匀速且归零时机准确。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { Alert, Button, Card, Select, Spin, Tag, Tooltip } from 'ant-design-vue';

import {
  schedulerComfyUiFree,
  schedulerComfyUiLoad,
  schedulerComfyUiModels,
  schedulerLive,
} from '#/api/core/scheduler';

/**
 * **取数节奏**（2026-10-07，用户两次调整后定为 500ms）：
 *
 * | # | 节奏 | 值 | 说明 |
 * |---|---|---|---|
 * | ① | 进度条步进 / 前端取数 | **500ms** | 本文件 setInterval，读内存缓存 |
 * | ② | 后端缓存写入 | **5000ms** | 编排器 tick（5s）—— 真正的"心跳" |
 * | ③ | 数据库写入 | **10min** | 审计，与界面无关 |
 *
 * ## 为什么 HTTP 取数与本地 tick 用**同一个** 500ms
 *
 * 两个定时器本来是分开的（各自一个周期，且都曾设为 100ms）。
 * 既然步进粒度就是 500ms，就没有必要让 HTTP 比它更快 ——
 * 取数比步进快只会重复拿到同一个缓存值，纯属浪费请求。
 *
 * 统一成 500ms 后：
 *   · 每 500ms 取一次缓存（2 次/秒，依然极轻量，且不查业务表）
 *   · 进度条每 500ms 前进一格，与取数同频 → 每次新数据都能立刻反映
 *   · 数据库节奏完全不受影响
 */
const POLL_MS = 500;

/** 进度条步进间隔 —— 与 POLL_MS 同频（见上方说明） */
const TICK_MS = 500;

/**
 * **光带满圈时长 = 死亡倒计时的量程**（用户 2026-10-07 明确）。
 *
 * ## 关键澄清（我一开始理解错了）
 *
 * 用户原话：
 * > 「我指的1圈是 10秒 每100毫秒 向前进一格 理论上 进到2000毫秒 就重置为0 了
 * >   代表心跳正常 如果 一直到 10秒 还没重置 就是 死了 超时了」
 *
 * 即：**满圈不是"播放周期"，而是"多久没心跳就算死"**。
 * <code>
 *   0° ────── 2s 应归零 ────────── 10s 判定死亡
 * </code>
 *   · 正常 → 每 2 秒数据刷新一次 → 光带**永远走不到头**（不断归零）
 *   · 患病 → 一直不归零 → 转到 10 秒满圈 → **停住 + 变警示色**
 *
 * 所以光带"看着总在滚、从不走满"才是**健康**的表现；
 * 一旦它转满停住，就是明确的故障信号。这比我上一版（追求转满一圈）语义强得多。
 */
const RING_TIMEOUT_MS = 10_000;

/**
 * 期望的心跳周期（毫秒）—— 超过它还没归零就转黄预警。
 *
 * ⚠️ 必须与**后端实际写入节奏**对齐，否则正常运行也会误报"偏慢"。
 *
 * 实测（2026-10-07）：
 *   · 编排器 tick = **5 秒**（TaskOrchestrator.Interval = 5s）
 *   · 于是缓存（也就 updatedAt）每 **5 秒**变一次
 *   · 网络与调度抖动给 1 秒余量 → 期望值取 **6 秒**
 *
 * 若设成 2 秒（= 用户口述的"2 秒更新一次"），会出现：
 * 正常运行时 t 在 2~5 秒区间被判"偏慢"、光带频繁转黄 —— **假警报**。
 * 满圈 10 秒（= 真死的判据）不变。
 */
const HEARTBEAT_EXPECT_MS = 6000;

const data = ref<null | SchedLiveView>(null);
const loading = ref(false);
const errorText = ref('');

let timer: null | ReturnType<typeof setInterval> = null;
/** 本地时钟（与取数同频 500ms）：推进进度，与网络请求解耦 */
let ticker: null | ReturnType<typeof setInterval> = null;

async function load() {
  loading.value = true;
  try {
    const res = await schedulerLive();
    data.value = res;

    // ── 心跳检测（光带归零的唯一触发点）──
    //
    // 后端每次写缓存都会换 updatedAt。它一变 → 心跳还在 → 光带归零重新计时。
    // 这正是用户描述的「进到 2000ms 就重置为 0，代表心跳正常」。
    //
    // ⚠️ 只在**真的变了**时归零：若每次轮询都无条件归零（每 500ms 一次），
    //    光带会永远停在起点不动，反而看不出任何信息。
    const stamp = res?.updatedAt ?? null;
    if (stamp && stamp !== lastSeenUpdatedAt.value) {
      lastSeenUpdatedAt.value = stamp;
      lastHeartbeatAt.value = Date.now();
    }

    errorText.value = '';
  } catch (e) {
    // 请求失败**不重置心跳** —— 拿不到数据本身就是"没心跳"的一种，
    // 光带继续走、到 10 秒转满变色，正好把故障暴露出来。
    errorText.value = (e as Error)?.message || '读取调度状态失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
  // 模型列表**只取一次**（磁盘上的文件很少变）—— 不跟着 500ms 轮询走，
  // 否则每半秒问一次 ComfyUI 的 /models，纯属浪费。
  void loadModels();
  timer = setInterval(load, POLL_MS);
  // 本地时钟只做一件事：推进 nowTick → 触发进度条重算。
  // 它不发请求，纯粹让进度在两次取数之间连续增长。
  ticker = setInterval(() => {
    nowTick.value = Date.now();
  }, TICK_MS);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (ticker) clearInterval(ticker);
  timer = null;
  ticker = null;
});

/** 数据是否僵死（后端判定） */
const isStale = computed(() => data.value?.stale === true);

/* ── 心跳计时 ──
 *
 * 核心：**以"后端 updatedAt 变化"为心跳信号**。
 *
 * 后端每次写入缓存都会换一个 updatedAt。前端每 500ms 取一次，
 * 一旦发现 updatedAt 变了，就说明"心跳还在" → 光带归零重新计时。
 *
 * ⚠️ 为什么用 updatedAt 而不是后端给的 staleSec：
 *    staleSec 是"缓存写入至今的秒数"，粒度是整秒，且随网络往返抖动；
 *    而 updatedAt 是**离散的心跳事件**（变 / 没变），用它判定归零最准，
 *    也天然符合用户描述的"进到 2000ms 就重置为 0"。
 */
/** 本地时钟（500ms 推进），仅用于驱动下面的 computed 重算 */
const nowTick = ref(Date.now());

/** 最近一次"心跳"（= updatedAt 变化）的本地时刻 */
const lastHeartbeatAt = ref(Date.now());

/**
 * 上次见到的后端 updatedAt —— 用来判断"这一轮是否发生了心跳"。
 *
 * 只有它**变化**才算心跳（见 load()）。若每轮无条件归零，
 * 每 500ms 一次无条件归零会让进度条永远停在起点，反而看不出任何信息。
 */
const lastSeenUpdatedAt = ref<null | string>(null);

/** 光带已行进的时间（毫秒）—— **心跳倒计时**，不是播放进度 */
const elapsedMs = computed(() =>
  Math.max(0, nowTick.value - lastHeartbeatAt.value),
);

/**
 * 心跳倒计时进度（0~1）—— **弧长**，不是"亮弧的起始角"。
 *
 * ⚠️ 为什么用"弧长增长"而不是"亮弧旋转"（2026-10-07 用户反馈后修正）：
 *
 * 上一版画一段**固定长度**的亮弧、只改它的**起始角**（旋转）。
 * 用户实测反馈「一直在无限滚动」—— 因为旋转视觉上就是"永远朝一个方向转"，
 * 而每 5 秒"跳回起点"**完全看不出来**（弧长没变，只是位置回去了）。
 * 于是"心跳重置"这个最该被看见的信号反而不可见。
 *
 * 改成弧长（0° 起、顺时针生长）后：
 *   · 正常 → 弧长只长到 ~50%（5s/10s）就被**清零重长** →「重置」一目了然
 *   · 故障 → 弧一路长满 360° → 视觉上明确"走满了、死了"
 * 长度是累加量，人眼对"长度突然回缩"极其敏感。
 */
const ringProgress = computed(() =>
  Math.min(1, elapsedMs.value / RING_TIMEOUT_MS),
);

/** 光带状态：正常 / 迟滞（超过期望心跳但还没到超时）/ 超时（死亡） */
const ringState = computed<'normal' | 'timeout' | 'warn'>(() => {
  if (elapsedMs.value >= RING_TIMEOUT_MS) return 'timeout';
  if (elapsedMs.value >= HEARTBEAT_EXPECT_MS) return 'warn';
  return 'normal';
});

/** 心跳是否超时（10 秒没有任何新数据 = 死了） */
const heartbeatDead = computed(
  () => ringState.value === 'timeout' || isStale.value,
);

/** 已无心跳的秒数（显示用） */
const deadSec = computed(() => Math.floor(elapsedMs.value / 1000));

/**
 * 决策产生至今的秒数 —— 界面上直接显示"（N 秒前）"。
 *
 * 为什么要显示：面板标题是"**当前**决策原因"，若数据真的旧了，
 * 用户必须能一眼看出来，而不是被"当前"二字误导
 *（此前正是因为读 10 分钟节流的审计，长期显示几十年前的旧状态）。
 */
const schedulerAgeSec = computed(() => {
  const at = scheduler.value?.at;
  if (!at) return null;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowTick.value - t) / 1000));
});

/** 显示"更新于 N 秒前"：直接用后端给的口径 */
const displayStaleSec = computed(() => data.value?.staleSec ?? 0);

const scheduler = computed(() => data.value?.scheduler ?? null);

const machines = computed(() => data.value?.machines ?? []);

/** GPU 显存占用（已装载模型合计 / 总量） */
function vramText(m: SchedLiveView['machines'][number]) {
  const used = m.runtimes.reduce((n, r) => n + r.loadedVramMb, 0);
  return `${(used / 1024).toFixed(1)} / ${(m.vramTotalMb / 1024).toFixed(0)} GB`;
}

/** 决策类型 → 展示文案 */
function decisionText(d: string) {
  const map: Record<string, string> = {
    Idle: '空闲（本轮未领取）',
    Claim: '领取任务（继续当前模型）',
    Switch: '切换模型',
    FirstLoad: '首次装载',
  };
  return map[d] ?? d;
}

/** runtime 种类 → 展示名 */
function kindText(k: string) {
  const map: Record<string, string> = { comfyui: 'ComfyUI', vllm: 'vLLM' };
  return map[k] ?? k;
}

/* ─────────── 运行时手动操作（2026-10-07，用户要求）─────────── */

/** 每个 runtime 当前选中的模型文件（按 runtimeId 存） */
const selectedModel = ref<Record<number, string | undefined>>({});

/** 正在进行的操作（用于按钮 loading，形如 `load-1` / `free-1`） */
const busy = ref('');

/** 操作结果提示（按 runtimeId 存）—— 显示**实测显存变化**而非只说"成功" */
const opResult = ref<Record<number, { ok: boolean; text: string }>>({});

/** ComfyUI 模型列表（多类别合并成一个下拉，选项前缀类别名便于区分） */
const modelOptions = ref<{ label: string; value: string }[]>([]);
const modelsLoading = ref(false);

/** 下拉的类别前缀（text_encoders 这类英文对用户不友好，给中文） */
function categoryLabel(t: string) {
  const map: Record<string, string> = {
    checkpoints: '主模型',
    clip_vision: '视觉编码',
    diffusion_models: '扩散模型',
    loras: 'LoRA',
    text_encoders: '文本编码',
    vae: 'VAE',
  };
  return map[t] ?? t;
}

async function loadModels() {
  modelsLoading.value = true;
  try {
    const res = await schedulerComfyUiModels();
    const opts: { label: string; value: string }[] = [];
    for (const c of res?.categories ?? []) {
      for (const f of c.files) {
        opts.push({ label: `[${categoryLabel(c.type)}] ${f}`, value: f });
      }
    }
    modelOptions.value = opts;
  } catch {
    // 读不到就留空；界面下方有"刷新列表"可重试（不弹错，避免每 500ms 轮询刷屏）
    modelOptions.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

/**
 * 下拉的本地搜索：类别前缀与文件名都参与匹配。
 *
 * ⚠️ option 的 label 类型是 antd 的 `DefaultOptionType['label']`（VNode | string | …），
 * 故这里转成 string 再匹配 —— 直接当 string 用会类型不兼容（编译期报错）。
 */
function filterModel(input: string, option?: { label?: unknown; value?: unknown }) {
  const q = input.toLowerCase();
  const label = String(option?.label ?? '').toLowerCase();
  const value = String(option?.value ?? '').toLowerCase();
  return label.includes(q) || value.includes(q);
}

/** 载入：提交极轻量工作流把模型装进显存，并用**显存差值**证明结果 */
async function doLoad(runtimeId: number) {
  const clipName = selectedModel.value[runtimeId];
  if (!clipName) return;

  busy.value = `load-${runtimeId}`;
  opResult.value[runtimeId] = { ok: true, text: `正在载入 ${clipName}…（最长 3 分钟）` };
  try {
    const r = await schedulerComfyUiLoad(runtimeId, clipName);
    const gb = (r.usedDeltaMb / 1024).toFixed(1);
    opResult.value[runtimeId] = {
      ok: r.usedDeltaMb > 0,
      text:
        r.usedDeltaMb > 0
          ? `已载入 ${clipName}：显存占用 +${gb} GB（剩余 ${(r.vramFreeAfterMb / 1024).toFixed(1)} GB）`
          : `工作流已执行但显存未变化（${clipName}）—— 该模型可能未被下游持有`,
    };
    await load();
  } catch (e) {
    opResult.value[runtimeId] = { ok: false, text: (e as Error)?.message || '载入失败' };
  } finally {
    busy.value = '';
  }
}

/** 清除：执行 /free 释放显存，并清空装载记账 */
async function doFree(runtimeId: number) {
  busy.value = `free-${runtimeId}`;
  try {
    const r = await schedulerComfyUiFree(runtimeId, true);
    opResult.value[runtimeId] = {
      ok: true,
      text: `已清除：剩余显存 ${(r.vramFreeMb / 1024).toFixed(1)} / ${(r.vramTotalMb / 1024).toFixed(0)} GB`,
    };
    await load();
  } catch (e) {
    opResult.value[runtimeId] = { ok: false, text: (e as Error)?.message || '清除失败' };
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <Card
    class="df-sched-card mb-3"
    :class="{
      'df-sched-stale': heartbeatDead,
      'df-sched-warn': !heartbeatDead && ringState === 'warn',
    }"
    size="small"
    title="调度器状态"
  >
    <template #extra>
      <span class="flex items-center gap-2">
        <!--
          数据新鲜度：**必须显示**。
          2 秒轮询下，若编排器停了，界面会一直显示最后那个值、看起来"很正常"。
          有时间戳 + 滚动边框停住，才能一眼看出僵死。
        -->
        <!--
          数据新鲜度：**必须显示**。
          高频刷新下，若编排器停了，界面会一直显示最后那个值、看起来"很正常"。
          有时间戳 + 光带转满停住，才能一眼看出僵死。
        -->
        <!--
          心跳指示：**光带转满 = 10 秒没收到新数据 = 死了**（用户语义）。
          正常时它每 2 秒左右归零一次、永远走不满 —— "总在滚、从不走满"才健康。
        -->
        <Tag :color="heartbeatDead ? 'error' : ringState === 'warn' ? 'warning' : 'success'" class="!mr-0">
          {{
            heartbeatDead
              ? `心跳超时 ${deadSec}s`
              : ringState === 'warn'
                ? `心跳偏慢 ${deadSec}s`
                : '心跳正常'
          }}
        </Tag>
        <span class="text-xs text-muted-foreground">
          {{ data?.ready ? `更新于 ${displayStaleSec} 秒前` : '缓存未就绪' }}
        </span>
      </span>
    </template>

    <Spin :spinning="loading && !data">
      <Alert v-if="errorText" class="mb-2" show-icon type="error" :message="errorText" />

      <!-- 缓存未就绪：如实说明，而不是显示"一切正常" -->
      <Alert
        v-else-if="data && !data.ready"
        class="mb-2"
        show-icon
        type="info"
        message="调度状态缓存尚未就绪"
        description="编排器每 5 秒写入一次，请稍候；若长时间如此，说明编排器未运行。"
      />

      <template v-else-if="data?.ready">
        <!--
          调度器在干嘛：这条回答"为什么不执行"。
          reasonText 是后端给的中文原因，界面**直接显示**，不做二次翻译
          （文案单一事实源在后端，避免两处漂移）。
        -->
        <!--
          滚动边框 = 心跳倒计时：**进度条宽度** = 距上次心跳的时间 / 10 秒。
          正常时每 5 秒**清零重长**（看得见的重置）；10 秒未重置则长满变红（死）。

          ## 为什么用「顶部进度条」而不是「边框渐变弧」（2026-10-07 第三次修正）

          前两版分别用：
            ① CSS animation 重放 → 一跳一跳（与数据节奏不同频）
            ② ::before + conic-gradient + CSS 变量 → **完全不动**
               （Chromium 对"伪元素 + 自定义属性 + 渐变"的变更**不保证重绘**，
                 变量改了但不重画，且不报错 —— 浏览器层面的静默失效）
            ③ 旋转亮弧 → 看着"无限滚动"，重置不可见（用户反馈）

          现在改用**普通 div 的 width**：
            · width 是常规布局属性，变化必然触发重绘（没有伪元素/渐变的坑）
            · 长度是累加量，"突然回缩"人眼极敏感 → 重置一目了然
            · 实现简单，不依赖任何浏览器特性
          宽度绑定直接写内联 style，不经过 CSS 变量中转。
        -->
        <div class="df-sched-ring mb-3 rounded-md border border-border p-3">
          <!--
            心跳倒计时条：宽度 = 进度。
            红色（超时）/ 黄色（偏慢）/ 主题色（正常）。
          -->
          <div
            class="df-heartbeat-track mb-2"
            :title="`心跳倒计时：${deadSec}s / ${RING_TIMEOUT_MS / 1000}s（刷新即归零）`"
          >
            <div
              class="df-heartbeat-bar"
              :class="
                heartbeatDead
                  ? 'df-hb-dead'
                  : ringState === 'warn'
                    ? 'df-hb-warn'
                    : 'df-hb-ok'
              "
              :style="{ width: `${(ringProgress * 100).toFixed(1)}%` }"
            ></div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">调度器</span>
            <Tag class="!mr-0">{{ decisionText(scheduler?.decision ?? '') }}</Tag>
            <Tag :color="scheduler?.gpuWindowOpen ? 'green' : 'default'" class="!mr-0">
              GPU 窗口 {{ scheduler?.gpuWindowOpen ? '开' : '关' }}
              {{ scheduler?.gpuWindow ? `(${scheduler.gpuWindow})` : '' }}
            </Tag>
            <Tag v-if="(scheduler?.totalQueued ?? 0) > 0" color="blue" class="!mr-0">
              排队 {{ scheduler?.totalQueued }}
            </Tag>
          </div>

          <!--
            当前决策原因 —— 数据来源是**编排器每轮（5 秒）写入的实时决策**。
            ⚠️ 曾经这里读的是 10 分钟节流的审计，于是长期显示几十年前的旧状态，
               还标着"当前"（用户实测反馈「显示的不对」）。现已改为读实时值。
            同时把**决策产生时刻**一并显示：万一它真的旧了，用户一眼就能看出来，
            而不是被"当前"二字误导。
          -->
          <div v-if="scheduler?.reasonText" class="mt-2 text-sm">
            <span class="text-muted-foreground">当前决策原因：</span>
            <span>{{ scheduler.reasonText }}</span>
            <span
              v-if="schedulerAgeSec !== null"
              class="ml-1 text-xs text-muted-foreground"
            >
              （{{ schedulerAgeSec }} 秒前）
            </span>
          </div>

          <!-- 收益/代价/阈值：让"为什么不切"可量化，而不是一句"在等待" -->
          <div
            v-if="scheduler?.benefitMin != null"
            class="mt-1 text-xs text-muted-foreground"
          >
            收益 {{ scheduler.benefitMin }}min
            <template v-if="scheduler.costMin != null">
              · 切换代价 {{ scheduler.costMin }}min
            </template>
            <template v-if="scheduler.thresholdMin != null">
              · 阈值 {{ scheduler.thresholdMin }}min
            </template>
          </div>
        </div>

        <!-- 每台机器在干嘛 -->
        <div
          v-for="m in machines"
          :key="m.machineId"
          class="mb-2 rounded-md border border-border p-3"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{{ m.machineName }}</span>
            <Tag :color="m.online ? 'success' : 'error'" class="!mr-0">
              {{ m.online ? '在线' : '离线' }}
            </Tag>
            <Tag class="!mr-0">显存 {{ vramText(m) }}</Tag>
            <Tooltip title="跨 runtime 切换（起停容器 + 载权重）的代价">
              <Tag class="!mr-0">跨 runtime {{ m.crossRuntimeCostMin }}min</Tag>
            </Tooltip>
          </div>

          <!-- 各运行时：装着谁、切换代价 -->
          <div class="mt-2 grid gap-2 md:grid-cols-2">
            <div
              v-for="r in m.runtimes"
              :key="r.runtimeId"
              class="rounded border border-border p-2"
            >
              <div class="flex flex-wrap items-center gap-1">
                <span class="text-sm font-medium">{{ kindText(r.kind) }}</span>
                <Tag :color="r.online ? 'success' : 'default'" class="!mr-0">
                  {{ r.online ? '在线' : '离线' }}
                </Tag>
                <Tooltip title="本运行时内部换模型的代价">
                  <Tag class="!mr-0">内部切换 {{ r.internalSwitchCostMin }}min</Tag>
                </Tooltip>
              </div>

              <!-- 装载的模型：这是"这台机器现在装着什么" -->
              <div class="mt-1 text-xs">
                <template v-if="r.loaded.length > 0">
                  <div
                    v-for="l in r.loaded"
                    :key="l.modelId"
                    class="flex items-center gap-1"
                  >
                    <span class="text-muted-foreground">装载：</span>
                    <span>{{ l.modelName || `#${l.modelId}` }}</span>
                    <span v-if="l.vramMb" class="text-muted-foreground">
                      ({{ (l.vramMb / 1024).toFixed(1) }} GB)
                    </span>
                    <!-- source=inferred 表示是显存推断来的，可信度低一档 -->
                    <Tooltip
                      v-if="l.source === 'inferred'"
                      title="该信息由显存占用推断而来（非派发记账），可信度较低"
                    >
                      <Tag class="!mr-0" color="orange">推断</Tag>
                    </Tooltip>
                  </div>
                </template>
                <span v-else class="text-muted-foreground">未装载任何模型</span>
              </div>

              <div v-if="r.endpoint" class="mt-1 text-xs text-muted-foreground">
                {{ r.endpoint }}
              </div>

              <!--
                手动操作（用户 2026-10-07 要求）：
                > 「在任务调度器 内的ComfyUI 内 加入 一个 清除按钮 执行/free
                >   一个Select 选择支持的模型 一个载入按钮 载入选择的模型」

                为什么需要手动入口：
                  · 清除 —— PE(18.8G) + 出图模型(15.2G) 超 24G 的 3090，
                    必须先卸干净才能装载；自动化已做，但卡住时要能手动腾显存。
                  · 载入 —— 提前把模型装进显存（预热），让装载与用户操作时间重叠。
              -->
              <div
                v-if="r.kind === 'comfyui'"
                class="mt-2 border-t border-border pt-2"
              >
                <div class="flex flex-wrap items-center gap-1">
                  <Select
                    v-model:value="selectedModel[r.runtimeId]"
                    :options="modelOptions"
                    :placeholder="modelsLoading ? '读取模型列表…' : '选择要载入的模型'"
                    :loading="modelsLoading"
                    allow-clear
                    show-search
                    size="small"
                    style="min-width: 220px"
                    :filter-option="filterModel"
                  />
                  <Button
                    size="small"
                    type="primary"
                    :loading="busy === `load-${r.runtimeId}`"
                    :disabled="!selectedModel[r.runtimeId]"
                    @click="doLoad(r.runtimeId)"
                  >
                    载入
                  </Button>
                  <Button
                    size="small"
                    danger
                    :loading="busy === `free-${r.runtimeId}`"
                    @click="doFree(r.runtimeId)"
                  >
                    清除
                  </Button>
                  <Tooltip title="读不到模型列表时点这里重试">
                    <Button size="small" type="link" @click="loadModels">
                      刷新列表
                    </Button>
                  </Tooltip>
                </div>

                <!-- 操作结果：显示**实测显存变化**，而不是只说"成功" -->
                <div
                  v-if="opResult[r.runtimeId]"
                  class="mt-1 text-xs"
                  :class="
                    opResult[r.runtimeId]!.ok
                      ? 'text-muted-foreground'
                      : 'text-destructive'
                  "
                >
                  {{ opResult[r.runtimeId]!.text }}
                </div>
              </div>
            </div>
          </div>

          <!-- 排队：按功能分组 + 最久等待 → 回答"卡在哪" -->
          <div v-if="m.queued.length > 0" class="mt-2">
            <div class="text-xs text-muted-foreground">排队中（按功能）</div>
            <div class="mt-1 flex flex-wrap gap-1">
              <Tag v-for="q in m.queued" :key="q.functionKey" color="blue">
                {{ q.functionName }}：{{ q.queued }} 个（最久 {{ q.oldestWaitMin }} 分钟）
              </Tag>
            </div>
          </div>
        </div>

        <div v-if="machines.length === 0" class="text-xs text-muted-foreground">
          没有已启用的算力机器。
        </div>
      </template>
    </Spin>
  </Card>
</template>
