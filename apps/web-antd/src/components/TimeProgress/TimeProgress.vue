<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

interface Props {
  /** 开始时间 (string/Date/number); 不传 = 从挂载时刻起算 */
  startTime?: Date | number | string | null;
  /** 结束时间; 不传 = 无限模式 (indeterminate) */
  endTime?: Date | number | string | null;
  /** 视觉填充方向 */
  fillDirection?: 'ltr' | 'rtl';
  /** 数值语义: elapsed=从 0% 涨到 100%(消耗感) / remaining=从 100% 跌到 0%(剩余感) */
  mode?: 'elapsed' | 'remaining';
  /** 下方左侧显示"剩余 xxx" */
  showRemaining?: boolean;
  /** 下方右侧显示"到期 yyyy-MM-dd HH:mm:ss" */
  showExpires?: boolean;
  /** 中心叠加文字模式 */
  centerText?: 'none' | 'percent' | 'remaining';
  /** 尺寸: small 8px / middle 16px / large 28px */
  size?: 'large' | 'middle' | 'small';
  /** 视觉风格: flat 极简平面 / glossy 顶部高光 / decorative 立体装饰(描边+强光泽+发光) */
  variant?: 'decorative' | 'flat' | 'glossy';
  /** 是否显示 45° 斜条纹动画 (运行中态), 默认 true */
  striped?: boolean;
  /** 进行中色 */
  color?: string;
  /** 过期色 */
  expiredColor?: string;
  /** 轨道（未填充部分）颜色，不传则用默认 hsl(var(--muted))。
   *  注意：必须用项目设计 token 体系（shadcn 的 :root 变量，如 hsl(var(--muted-foreground)/0.3)），
   *  不要传 var(--ant-color-*)：antd v5 cssVar 模式的变量只在 antd 组件内部作用域有定义，
   *  在自定义元素上 var(--ant-color-*) 无法解析，整个 background declaration 会被丢弃。 */
  trackColor?: string;
  /** 文案 */
  notStartedText?: string;
  infiniteText?: string;
  expiredText?: string;
  /** 刷新间隔 ms */
  refreshInterval?: number;
}

const props = withDefaults(defineProps<Props>(), {
  startTime: null,
  endTime: null,
  fillDirection: 'ltr',
  mode: 'elapsed',
  showRemaining: true,
  showExpires: false,
  centerText: 'none',
  size: 'middle',
  color: 'hsl(var(--primary))',
  expiredColor: 'hsl(var(--destructive))',
  notStartedText: '未开始',
  infiniteText: '运行中',
  expiredText: '已过期',
  refreshInterval: 1000,
  variant: 'flat',
  striped: true,
});

const emit = defineEmits<{
  start: [];
  expire: [];
  'update:percent': [percent: number];
}>();

// 后端 UTC 字符串没带 Z 时按本地时间解析会有偏差, 兜底补 Z
function parseTime(v: Date | null | number | string | undefined): null | number {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const hasTz = /[Zz]|[+-]\d\d:?\d\d$/.test(v);
    const t = new Date(hasTz ? v : `${v}Z`).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// 挂载时刻 (作为 startTime 缺省值)
const mountedAt = Date.now();

const start = computed<number>(() => parseTime(props.startTime) ?? mountedAt);
const end = computed<null | number>(() => parseTime(props.endTime));
const isInfinite = computed(() => end.value === null);

// 当前时刻, 由定时器驱动
const now = ref(Date.now());
let timer: null | ReturnType<typeof setInterval> = null;

function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    now.value = Date.now();
  }, Math.max(100, props.refreshInterval));
}

onMounted(() => startTimer());
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  timer = null;
});
watch(() => props.refreshInterval, () => startTimer());

// === 状态机 ===
type Status = 'expired' | 'infinite' | 'not-started' | 'running';

const status = computed<Status>(() => {
  if (isInfinite.value) return 'infinite';
  if (now.value < start.value) return 'not-started';
  if (now.value >= end.value!) return 'expired';
  return 'running';
});

// === 进度百分比 (0-100, 受 mode 影响) ===
const elapsedPercent = computed<number>(() => {
  if (status.value === 'not-started') return 0;
  if (status.value === 'expired') return 100;
  if (status.value === 'infinite') return 0; // 不参与百分比计算
  const total = end.value! - start.value;
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, ((now.value - start.value) / total) * 100));
});

// 实际渲染填充百分比
const fillPercent = computed<number>(() => {
  if (props.mode === 'remaining') return 100 - elapsedPercent.value;
  return elapsedPercent.value;
});

// === 状态变更触发事件 ===
let lastStatus: Status = 'not-started';
watch(status, (s) => {
  if (s === 'running' && lastStatus !== 'running') emit('start');
  if (s === 'expired' && lastStatus !== 'expired') emit('expire');
  lastStatus = s;
});
watch(elapsedPercent, (p) => emit('update:percent', p));

// === 剩余时间格式化 ===
function fmtRemaining(ms: number): string {
  if (ms <= 0) return '0 秒';
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} 天`);
  if (days > 0 || hours > 0) parts.push(`${String(hours).padStart(2, '0')} 时`);
  parts.push(
    `${String(minutes).padStart(2, '0')} 分`,
    `${String(seconds).padStart(2, '0')} 秒`,
  );
  return parts.join(' ');
}

const remainingText = computed(() => {
  if (status.value === 'not-started') return props.notStartedText;
  if (status.value === 'expired') return props.expiredText;
  if (status.value === 'infinite') return props.infiniteText;
  return fmtRemaining(end.value! - now.value);
});

// === 到期时间格式化 (按本地时区显示) ===
function fmtExpires(ts: null | number): string {
  if (ts == null) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const expiresText = computed(() => fmtExpires(end.value));

// === 中心文字 ===
const centerContent = computed(() => {
  if (props.centerText === 'none') return '';
  if (status.value === 'expired') return props.expiredText;
  if (status.value === 'not-started') return props.notStartedText;
  if (status.value === 'infinite') return props.infiniteText;
  if (props.centerText === 'percent') {
    return `${Math.round(elapsedPercent.value)}%`;
  }
  return fmtRemaining(end.value! - now.value);
});

// === 尺寸 ===
const heightPx = computed(() => {
  switch (props.size) {
    case 'large': {
      return 28;
    }
    case 'small': {
      return 8;
    }
    default: {
      return 16;
    }
  }
});

// === 当前主色 ===
const activeColor = computed(() => {
  if (status.value === 'expired') return props.expiredColor;
  if (status.value === 'not-started') return 'hsl(var(--muted-foreground))';
  return props.color;
});
</script>

<template>
  <div class="time-progress">
    <!-- 进度条本体 -->
    <div
      class="time-progress__track"
      :class="[
        `time-progress__track--${variant}`,
        {
          'time-progress__track--expired': status === 'expired',
        },
      ]"
      :style="{
        height: `${heightPx}px`,
        // expired 状态整条变红，优先级最高；非 expired 时若传了 trackColor 就覆盖默认 muted
        ...(trackColor && status !== 'expired' ? { background: trackColor } : {}),
        ...(status === 'expired' ? { background: expiredColor } : {}),
      }"
    >
      <!-- 区间模式: 填充条 -->
      <div
        v-if="status !== 'infinite'"
        class="time-progress__fill"
        :class="[
          `time-progress__fill--${variant}`,
          {
            'time-progress__fill--striped':
              striped && status === 'running',
            'time-progress__fill--rtl': fillDirection === 'rtl',
          },
        ]"
        :style="{
          width: `${fillPercent}%`,
          background: activeColor,
        }"
      />

      <!-- 无限模式: indeterminate 往复亮条 -->
      <div
        v-else
        class="time-progress__indeterminate"
        :class="{
          'time-progress__indeterminate--rtl': fillDirection === 'rtl',
        }"
        :style="{ background: activeColor }"
      />

      <!-- 中心文字 -->
      <div
        v-if="centerText !== 'none' || $slots.center"
        class="time-progress__center"
      >
        <slot name="center">{{ centerContent }}</slot>
      </div>
    </div>

    <!-- 下方文字行 -->
    <div
      v-if="$slots.sub || showRemaining || showExpires"
      class="time-progress__sub"
    >
      <slot name="sub">
        <span v-if="showRemaining" class="time-progress__sub-left">
          <span class="time-progress__sub-label">剩余</span>
          <span
            class="time-progress__sub-value"
            :class="{
              'time-progress__sub-value--expired': status === 'expired',
            }"
          >{{ remainingText }}</span>
        </span>
        <span v-if="showExpires" class="time-progress__sub-right">
          <span class="time-progress__sub-label">到期</span>
          <span class="time-progress__sub-value">{{ expiresText }}</span>
        </span>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.time-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

/* 轨道 */
.time-progress__track {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: hsl(var(--muted));
  border-radius: 999px;
}

/* 过期态: 整条红色闪烁 (危险视觉) */
.time-progress__track--expired {
  animation: time-progress-blink 1s ease-in-out infinite;
}

@keyframes time-progress-blink {
  0%, 100% { opacity: 1; }

  50% { opacity: 0.4; }
}

/* 区间模式填充 */
.time-progress__fill {
  position: relative;
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s linear;
}

.time-progress__fill--rtl {
  margin-left: auto;
}

/* striped: 45° 斜条纹流动 (Bootstrap 经典 progress bar) */
.time-progress__fill--striped::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background-image: linear-gradient(
    45deg,
    rgb(255 255 255 / 32%) 25%,
    transparent 25%,
    transparent 50%,
    rgb(255 255 255 / 32%) 50%,
    rgb(255 255 255 / 32%) 75%,
    transparent 75%,
    transparent
  );
  background-size: 16px 16px;
  border-radius: 999px;
  animation: time-progress-stripes 1s linear infinite;
}

/* rtl 反向填充时条纹向反方向流动, 视觉跟填充方向一致 */
.time-progress__fill--rtl.time-progress__fill--striped::before {
  animation-direction: reverse;
}

@keyframes time-progress-stripes {
  from { background-position: 16px 0; }

  to { background-position: 0 0; }
}

/* === variant: glossy === 顶部白色渐变高光, 让条有光泽 */
.time-progress__fill--glossy::after {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 50%;
  pointer-events: none;
  content: '';
  background: linear-gradient(
    to bottom,
    rgb(255 255 255 / 35%),
    rgb(255 255 255 / 0%)
  );
  border-radius: 999px 999px 0 0;
}

/* === variant: decorative === 强光泽 + 发光 + 描边胶囊 */
.time-progress__track--decorative {
  border: 1px solid hsl(var(--border));
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 25%);
}

.time-progress__fill--decorative::after {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 50%;
  pointer-events: none;
  content: '';
  background: linear-gradient(
    to bottom,
    rgb(255 255 255 / 55%),
    rgb(255 255 255 / 5%)
  );
  border-radius: 999px 999px 0 0;
}

.time-progress__fill--decorative {
  /* 主色发光投影 (沿用 fill 当前 background 颜色不太可控, 用 currentColor 模拟) */
  filter: drop-shadow(0 0 4px rgb(255 255 255 / 15%));
}

/* 无限模式: 一段亮条 0%→100%→0% 往复 */
.time-progress__indeterminate {
  position: absolute;
  top: 0;
  width: 35%;
  height: 100%;
  border-radius: 999px;
  animation: time-progress-indeterminate 1.8s ease-in-out infinite alternate;
}

.time-progress__indeterminate--rtl {
  animation-direction: alternate-reverse;
}

@keyframes time-progress-indeterminate {
  0% { left: 0; }

  100% { left: 65%; }
}

/* 中心叠加文字: 白字 + 描边 + 阴影, 在任意底色上保持清晰 */
.time-progress__center {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #fff;
  letter-spacing: 0.3px;

  /* 多向 text-shadow 模拟 outline 描边, 比单方向阴影对比更稳 */
  text-shadow:
    -1px -1px 0 rgb(0 0 0 / 55%),
    1px -1px 0 rgb(0 0 0 / 55%),
    -1px 1px 0 rgb(0 0 0 / 55%),
    1px 1px 0 rgb(0 0 0 / 55%),
    0 1px 3px rgb(0 0 0 / 50%);
  pointer-events: none;
  -webkit-text-stroke: 0.4px rgb(0 0 0 / 45%);
}

/* 下方一行 */
.time-progress__sub {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: hsl(var(--muted-foreground));
}

.time-progress__sub-left,
.time-progress__sub-right {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
}

.time-progress__sub-label {
  color: hsl(var(--muted-foreground));
  opacity: 0.7;
}

.time-progress__sub-value {
  font-weight: 500;
  color: hsl(var(--foreground));
}

.time-progress__sub-value--expired {
  color: hsl(var(--destructive));
}
</style>
