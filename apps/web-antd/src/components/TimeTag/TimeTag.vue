<script lang="ts" setup>
import { computed } from 'vue';

import { Tag } from 'ant-design-vue';

const props = withDefaults(
  defineProps<{
    /** Tag 颜色，沿用 antd Tag color prop（preset 名或十六进制） */
    color?: string;
    /** 占位符（time 为空时显示），默认 -- */
    placeholder?: string;
    /** 是否启用等宽数字（避免跑动数字时跳宽），默认开 */
    tabular?: boolean;
    /** 时间字符串（"2026-05-10 14:41:02" / "00:01:23.45" 等） */
    time?: null | string;
    /**
     * IANA 时区，可选；传了之后下方会多一行小字显示
     * "Asia/Shanghai +8" 这种格式，告诉用户这个时间是哪个时区的
     */
    timezone?: null | string;
  }>(),
  {
    color: 'blue',
    placeholder: '--',
    tabular: true,
    time: null,
    timezone: null,
  },
);

/** 从 IANA 时区取 UTC 偏移字符串（"+8" / "-7" / "+5:30" 等） */
const offsetText = computed(() => {
  if (!props.timezone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: props.timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    if (raw === 'GMT' || raw === 'UTC') return '+0';
    return raw.replace(/^(GMT|UTC)/, '');
  } catch {
    return '';
  }
});

/**
 * 规整展示用时间串。仅当 time 是 ISO/完整日期时间形态
 * （YYYY-MM-DD[T| ]HH:mm:ss[.ffffff][时区后缀]）时，去掉 T 分隔符与微秒小数，
 * 统一成 "YYYY-MM-DD HH:mm:ss"。其它格式（运行时长 "00:01:23.45"、已格式化串、
 * 占位符等）原样透传，避免误伤非日期值。
 */
const displayTime = computed(() => {
  const raw = props.time;
  if (!raw) return props.placeholder;
  const m = String(raw).match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?/,
  );
  return m ? `${m[1]} ${m[2]}` : raw;
});

// 时间为空或纯占位符（"-" / "--" / "暂无" 等不含数字的字符串）时不显示时区行
// 真实时间至少含一位数字，用 /\d/ 区分
const showTimezone = computed(() => {
  if (!props.timezone || !props.time) return false;
  return /\d/.test(String(props.time));
});
</script>

<template>
  <Tag
    :color="color"
    class="time-tag"
    :class="[
      { 'time-tag--two-line': showTimezone, 'time-tag--tabular': tabular },
    ]"
  >
    <div class="time-tag__time">{{ displayTime }}</div>
    <div v-if="showTimezone" class="time-tag__tz">
      <span class="time-tag__tz-iana">{{ timezone }}</span>
      <span v-if="offsetText" class="time-tag__tz-offset">{{
        offsetText
      }}</span>
    </div>
  </Tag>
</template>

<style scoped>
.time-tag--tabular {
  font-variant-numeric: tabular-nums;
}

/* 双行模式：拉开行高、加点垂直内边距，整体看起来更像信息块 */
.time-tag--two-line {
  display: inline-block;
  padding-top: 3px;
  padding-bottom: 3px;
  line-height: 1.25;
}

.time-tag__time {
  font-size: 13px;
}

.time-tag__tz {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.9;
}

.time-tag__tz-offset {
  font-weight: 600;
}
</style>
