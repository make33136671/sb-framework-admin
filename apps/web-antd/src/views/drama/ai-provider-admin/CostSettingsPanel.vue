<script lang="ts" setup>
import type { SystemSettingRow } from './api';

/**
 * CostSettingsPanel —— 成本与调度设置（前端设计 §6.2）
 *
 * 这是**唯一会让系统主动花钱**的开关集合，因此界面上必须把三件事说清楚：
 *   ① 默认关闭，且开启前明确提示"会主动花钱"（沿用"默认不花钱"铁律）；
 *   ② 性价比阈值 `30` 这个数字很抽象 → **配两个具体算例**（省 117min/¥0.42 → 279 ≥ 30 → 上云）；
 *   ③ 单任务 / 单日双上限 + **今日花费进度条**（让用户对当天花费有直观感知）。
 *
 * 设置项存框架「系统设置」（键名见 api.ts 注释），后端**每轮重读**，改完立即生效。
 * 不写配对 toast（拦截器已统一处理）。
 */
import { computed, onMounted, ref } from 'vue';

import {
  Alert,
  Button,
  Card,
  Divider,
  InputNumber,
  Progress,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  cloudDecisions,
  getSystemSettingByKey,
  saveSystemSettings,
} from './api';

/** 6 个设置项的键与默认值（与后端 DramaModuleInitializer 定义一致） */
const KEYS = {
  enabled: 'sched_cloud_cost_aware_enabled',
  ratio: 'sched_cloud_value_ratio',
  maxPerTask: 'sched_cloud_max_cost_per_task',
  maxPerDay: 'sched_cloud_max_cost_per_day',
  preferOffpeak: 'sched_cloud_prefer_offpeak',
  fallbackTokens: 'sched_cloud_estimate_fallback_tokens',
} as const;

const loading = ref(false);
const saving = ref(false);
/** 原始行（保存时要整行回传，SaveList 是整行更新） */
const rawRows = ref<Record<string, SystemSettingRow>>({});

const form = ref({
  enabled: false,
  ratio: 30,
  maxPerTask: 2,
  maxPerDay: 20,
  preferOffpeak: true,
  fallbackTokens: 2000,
});

/** 今日已花费（从最近的上云审计行取，缺失则 0） */
const todaySpent = ref(0);

// ─────────────────────────── 读取 ───────────────────────────

function asBool(v: null | string | undefined, dft: boolean): boolean {
  if (v === null || v === undefined || v === '') return dft;
  return v.toLowerCase() === 'true' || v === '1';
}

function asNum(v: null | string | undefined, dft: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dft;
}

async function load() {
  loading.value = true;
  try {
    const entries = await Promise.all(
      Object.entries(KEYS).map(async ([field, key]) => {
        try {
          const row = await getSystemSettingByKey(key);
          return [field, row] as const;
        } catch {
          // 单条缺失（如后端尚未注册）→ 不影响其他项
          return [field, null] as const;
        }
      }),
    );
    const rows: Record<string, SystemSettingRow> = {};
    const valueOf = (field: string): null | string | undefined =>
      rows[field]?.dataContent;
    for (const [field, row] of entries) {
      if (row) rows[field] = row;
    }
    rawRows.value = rows;
    form.value = {
      enabled: asBool(valueOf('enabled'), false),
      ratio: asNum(valueOf('ratio'), 30),
      maxPerTask: asNum(valueOf('maxPerTask'), 2),
      maxPerDay: asNum(valueOf('maxPerDay'), 20),
      preferOffpeak: asBool(valueOf('preferOffpeak'), true),
      fallbackTokens: asNum(valueOf('fallbackTokens'), 2000),
    };
    await loadTodaySpent();
  } finally {
    loading.value = false;
  }
}

/**
 * 今日已花费：直接用 `Scheduler/CloudDecisions` 返回的 `todaySpent`（后端按
 * audit_log.cost_yuan 当日求和，与 T13.8 同一数据源）—— **不再由前端从审计行推算**
 * （旧版前端推算依赖的审计行端点并不存在，且本地时区切日与后端 UTC 切日不一致）。
 */
async function loadTodaySpent() {
  try {
    const data = await cloudDecisions(1);
    todaySpent.value =
      typeof data?.todaySpent === 'number' ? data.todaySpent : 0;
  } catch {
    todaySpent.value = 0;
  }
}

onMounted(() => void load());

// ─────────────────────────── 保存 ───────────────────────────

async function save() {
  saving.value = true;
  try {
    const f = form.value;
    const patch: Record<string, string> = {
      enabled: String(f.enabled),
      ratio: String(f.ratio ?? 30),
      maxPerTask: String(f.maxPerTask ?? 2),
      maxPerDay: String(f.maxPerDay ?? 20),
      preferOffpeak: String(f.preferOffpeak),
      fallbackTokens: String(f.fallbackTokens ?? 2000),
    };
    const rows: SystemSettingRow[] = [];
    for (const [field, value] of Object.entries(patch)) {
      const base = rawRows.value[field];
      if (!base) continue; // 未注册的键跳过（不伪造设置行）
      rows.push({ ...base, dataContent: value });
    }
    if (rows.length === 0) return;
    await saveSystemSettings(rows);
    await load();
  } catch {
    // 拦截器已提示
  } finally {
    saving.value = false;
  }
}

// ─────────────────────────── 展示辅助 ───────────────────────────

/** 单日进度条：今日花费 / 单日上限 */
const dailyPercent = computed(() => {
  const cap = form.value.maxPerDay || 0;
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((todaySpent.value / cap) * 100));
});

const dailyExceeded = computed(
  () =>
    (form.value.maxPerDay || 0) > 0 && todaySpent.value >= form.value.maxPerDay,
);

const dailyStatus = computed(() =>
  dailyExceeded.value
    ? 'exception'
    : dailyPercent.value >= 80
      ? 'active'
      : 'normal',
);

/** 阈值算例（把 "30" 这个抽象数字变成两个具体场景） */
const ratio = computed(() => form.value.ratio || 30);
</script>

<template>
  <div class="flex flex-col gap-3">
    <Skeleton v-if="loading" active :paragraph="{ rows: 6 }" />

    <template v-else>
      <!-- 每日成本摘要（§6.5：让用户对当天花费有直观感知） -->
      <Card size="small">
        <div class="flex flex-wrap items-center gap-x-8 gap-y-2">
          <div>
            <div class="text-xs text-muted-foreground">今日花费</div>
            <div class="text-lg font-medium tabular-nums">
              ¥{{ todaySpent.toFixed(2) }}
              <span class="text-xs text-muted-foreground">
                / ¥{{ (form.maxPerDay || 0).toFixed(2) }}
              </span>
            </div>
          </div>
          <div class="min-w-[220px] flex-1">
            <Progress
              :percent="dailyPercent"
              :status="dailyStatus"
              size="small"
            />
            <div class="mt-1 text-xs text-muted-foreground">
              <template v-if="dailyExceeded">
                已达单日上限：当日停止成本感知上云，次日自动恢复
              </template>
              <template v-else>
                达上限后当日停止（次日恢复）；上限只拦成本感知上云，不拦紧急兜底与手动指定
              </template>
            </div>
          </div>
        </div>
      </Card>

      <!-- ① 总开关：默认关，且明确"会主动花钱" -->
      <Card size="small" title="主动花钱上云">
        <div class="flex items-start gap-3">
          <Switch v-model:checked="form.enabled" />
          <div class="flex-1">
            <div class="text-sm">
              {{ form.enabled ? '已开启：会主动花钱' : '已关闭（默认）' }}
              <Tag v-if="form.enabled" class="ml-2 !mr-0" color="warning">
                ⚠️ 会产生费用
              </Tag>
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              开启后，系统会在【优惠时段】自动把"本地排队久"的任务送到云端执行（独立算力，不占本地槽位）。
              关闭后仅在紧急兜底与手动指定时上云。
            </div>
          </div>
        </div>
      </Card>

      <!-- ② 判定规则：阈值 + 两个具体算例 -->
      <Card size="small" title="判定规则">
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm">性价比阈值</span>
          <InputNumber
            v-model:value="form.ratio"
            :min="0"
            :precision="0"
            :step="1"
            addon-after="分钟/元"
            style="width: 180px"
          />
          <span class="text-xs text-muted-foreground">
            省下的等待时间 ÷ 花的钱 ≥ 该值 → 判定划算
          </span>
        </div>

        <Alert class="mt-3" type="info">
          <template #message>阈值怎么理解？两个算例</template>
          <template #description>
            <div class="text-xs leading-6">
              📊 本地要等 2 小时，云端 3 分钟完成，花 0.42 元<br />
              → 省 117 分钟 ÷ 0.42 元 = <b>279</b> ≥ {{ ratio }} →
              <span class="font-medium">✅ 上云</span><br />
              本地要等 10 分钟，云端 3 分钟，花 1.5 元<br />
              → 省 7 分钟 ÷ 1.5 元 = <b>4.7</b> &lt; {{ ratio }} →
              <span class="font-medium">❌ 不上云</span>
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              「省 30 分钟花 1 元 = 30，≥ 阈值 {{ ratio }} → 上云」——
              阈值越大越省钱，越小越舍得花钱买时间。
            </div>
          </template>
        </Alert>
      </Card>

      <!-- ③ 花钱上限（双上限刹车） -->
      <Card size="small" title="花钱上限">
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm">单任务上限</span>
            <InputNumber
              v-model:value="form.maxPerTask"
              :min="0"
              :precision="2"
              :step="0.5"
              addon-after="元"
              style="width: 180px"
            />
            <span class="text-xs text-muted-foreground"
              >超过则该任务永不上云</span
            >
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm">单日上限</span>
            <InputNumber
              v-model:value="form.maxPerDay"
              :min="0"
              :precision="2"
              :step="1"
              addon-after="元"
              style="width: 180px"
            />
            <span class="text-xs text-muted-foreground">
              达上限后当日停止（次日按本地日期自动恢复）
            </span>
          </div>
        </div>
      </Card>

      <!-- ④ 时段偏好 + token 预估回退 -->
      <Card size="small" title="时段与预估">
        <div class="flex flex-col gap-3">
          <div class="flex items-start gap-3">
            <Switch v-model:checked="form.preferOffpeak" />
            <div>
              <div class="text-sm">只在优惠时段上云</div>
              <div class="text-xs text-muted-foreground">
                关闭后峰时也会按性价比判定（通常不划算，不推荐）。
              </div>
            </div>
          </div>

          <Divider class="!my-1" />

          <div class="flex flex-wrap items-center gap-3">
            <Tooltip
              title="该任务的历史平均 token 样本不足时，用此保守值估算花费"
            >
              <span class="text-sm">Token 预估回退值</span>
            </Tooltip>
            <InputNumber
              v-model:value="form.fallbackTokens"
              :min="0"
              :precision="0"
              :step="500"
              addon-after="tokens"
              style="width: 200px"
            />
            <span class="text-xs text-muted-foreground">
              历史样本不足时的保守估算（越低越保守，越不容易误判为划算）
            </span>
          </div>
        </div>
      </Card>

      <div>
        <Space>
          <Button :loading="saving" size="small" type="primary" @click="save">
            保存
          </Button>
          <span class="text-xs text-muted-foreground">
            后端每轮重读设置，保存后立即生效（无需重启）
          </span>
        </Space>
      </div>
    </template>
  </div>
</template>
