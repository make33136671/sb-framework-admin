<script lang="ts" setup>
import { computed } from 'vue';

import { Tag } from 'ant-design-vue';

const props = defineProps<{
  /** IANA 时区 ID（如 Asia/Shanghai）； 空值组件返回 '--' */
  timezone?: null | string;
}>();

/** 大洲英文 → 中文 */
const CONTINENT_ZH: Record<string, string> = {
  Africa: '非洲',
  America: '美洲',
  Antarctica: '南极洲',
  Arctic: '北极',
  Asia: '亚洲',
  Atlantic: '大西洋',
  Australia: '大洋洲',
  Europe: '欧洲',
  Indian: '印度洋',
  Pacific: '太平洋',
};

/** 城市英文 → 中文（覆盖常见时区，未匹配回退英文名） */
const CITY_ZH: Record<string, string> = {
  Amsterdam: '阿姆斯特丹',
  Anchorage: '安克雷奇',
  Athens: '雅典',
  Auckland: '奥克兰',
  Baghdad: '巴格达',
  Bangkok: '曼谷',
  Beijing: '北京',
  Berlin: '柏林',
  Brussels: '布鲁塞尔',
  Buenos_Aires: '布宜诺斯艾利斯',
  Cairo: '开罗',
  Chicago: '芝加哥',
  Chongqing: '重庆',
  Copenhagen: '哥本哈根',
  Denver: '丹佛',
  Dhaka: '达卡',
  Dubai: '迪拜',
  Helsinki: '赫尔辛基',
  Ho_Chi_Minh: '胡志明市',
  Hong_Kong: '香港',
  Honolulu: '檀香山',
  Istanbul: '伊斯坦布尔',
  Jakarta: '雅加达',
  Johannesburg: '约翰内斯堡',
  Kabul: '喀布尔',
  Karachi: '卡拉奇',
  Kolkata: '加尔各答',
  Kuala_Lumpur: '吉隆坡',
  Lisbon: '里斯本',
  London: '伦敦',
  Los_Angeles: '洛杉矶',
  Macau: '澳门',
  Madrid: '马德里',
  Manila: '马尼拉',
  Melbourne: '墨尔本',
  Mexico_City: '墨西哥城',
  Moscow: '莫斯科',
  New_York: '纽约',
  Paris: '巴黎',
  Phnom_Penh: '金边',
  Rangoon: '仰光',
  Riyadh: '利雅得',
  Rome: '罗马',
  Sao_Paulo: '圣保罗',
  Seoul: '首尔',
  Shanghai: '上海',
  Singapore: '新加坡',
  Stockholm: '斯德哥尔摩',
  Sydney: '悉尼',
  Taipei: '台北',
  Tehran: '德黑兰',
  Tokyo: '东京',
  Toronto: '多伦多',
  Urumqi: '乌鲁木齐',
  Vancouver: '温哥华',
  Vientiane: '万象',
  Vienna: '维也纳',
  Vladivostok: '符拉迪沃斯托克',
  Warsaw: '华沙',
  Yekaterinburg: '叶卡捷琳堡',
};

/** 取 UTC 偏移字符串（"+8" / "-7" / "+5:30"） */
function getOffset(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    if (raw === 'GMT' || raw === 'UTC') return '+0';
    return raw.replace(/^(GMT|UTC)/, '');
  } catch {
    return '';
  }
}

/** "亚洲 上海" 中文友好名（不含偏移） */
const zhName = computed(() => {
  const tz = props.timezone;
  if (!tz) return '';
  const segs = tz.split('/');
  if (segs.length < 2) return '';
  const continent = CONTINENT_ZH[segs[0]!] || segs[0]!;
  const cityKey = segs.at(-1)!;
  const city = CITY_ZH[cityKey] || cityKey.replace(/_/g, ' ');
  return `${continent} ${city}`;
});

const offset = computed(() =>
  props.timezone ? getOffset(props.timezone) : '',
);
</script>

<template>
  <span v-if="!timezone" class="tz-empty">--</span>
  <span v-else class="tz-cell">
    <span class="tz-iana">{{ timezone }}</span>
    <span v-if="zhName" class="tz-name">{{ zhName }}</span>
    <Tag v-if="offset" color="geekblue" class="tz-offset">UTC{{ offset }}</Tag>
  </span>
</template>

<style scoped>
.tz-cell {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.tz-iana {
  font-family:
    ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas,
    monospace;
  font-size: 12px;
  color: var(--ant-color-text-secondary);
}

.tz-name {
  color: var(--ant-color-text);
}

.tz-offset {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.tz-empty {
  color: var(--ant-color-text-tertiary);
}
</style>
