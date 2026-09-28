<script lang="ts" setup>
/**
 * PhaseStepper —— 剧目五阶段进度条（契约 §5.3 drama.stages）
 *
 * stages 取值：pending / running / rendering / generating / pending_review /
 *              done / published / stale / concat
 * 颜色只用 antd preset，禁硬编码色值。
 */
import { computed } from 'vue';

import { Steps, Tag, Tooltip } from 'ant-design-vue';

interface Props {
  /** 后端 drama 事件的 stages 字典 */
  stages?: null | Record<string, string>;
  /** 紧凑模式（列表行内用） */
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  stages: null,
  compact: false,
});

/** 阶段顺序与中文名（与后端 BuildStages 的 key 一一对应） */
const PHASES: { desc: string; key: string; label: string }[] = [
  { key: 'rewrite', label: '洗稿', desc: '原始剧本 → 10 集改写' },
  { key: 'storyboard', label: '分镜', desc: '每集 8–12 镜' },
  { key: 'assets', label: '素材', desc: '角色/场景图候选与审核' },
  { key: 'clips', label: '片段', desc: '分镜 → 视频片段' },
  { key: 'product', label: '成片', desc: '合并成集 + 封面' },
];

/** 阶段状态 → Steps 状态 */
function stepStatus(v: string): 'error' | 'finish' | 'process' | 'wait' {
  if (v === 'done' || v === 'published') return 'finish';
  if (v === 'stale') return 'error';
  if (
    ['concat', 'generating', 'pending_review', 'rendering', 'running'].includes(
      v,
    )
  )
    return 'process';
  return 'wait';
}

const current = computed(() => {
  const s = props.stages ?? {};
  // 第一个未完成的阶段高亮；全完成则指向最后一个
  const idx = PHASES.findIndex((p) => {
    const v = s[p.key];
    return v !== 'done' && v !== 'published';
  });
  return idx === -1 ? PHASES.length - 1 : idx;
});

function textOf(key: string): string {
  const v = props.stages?.[key];
  switch (v) {
    case 'concat': {
      return '合成中';
    }
    case 'done': {
      return '已完成';
    }
    case 'generating': {
      return '生成中';
    }
    case 'pending_review': {
      return '待审核';
    }
    case 'published': {
      return '已发布';
    }
    case 'rendering': {
      return '渲染中';
    }
    case 'running': {
      return '进行中';
    }
    case 'stale': {
      return '已失效';
    }
    default: {
      return '未开始';
    }
  }
}

function tagColor(key: string): string {
  const v = props.stages?.[key];
  if (v === 'done' || v === 'published') return 'success';
  if (v === 'stale') return 'error';
  if (v === 'pending_review') return 'warning';
  if (v && v !== 'pending') return 'processing';
  return 'default';
}
</script>

<template>
  <!-- 紧凑模式：一行 Tag（列表用） -->
  <div v-if="compact" class="flex flex-wrap items-center gap-1">
    <Tooltip v-for="p in PHASES" :key="p.key" :title="p.desc">
      <Tag :color="tagColor(p.key)" class="!mr-0">
        {{ p.label }}·{{ textOf(p.key) }}
      </Tag>
    </Tooltip>
  </div>

  <!-- 完整模式：Steps（详情页用） -->
  <Steps v-else :current="current" size="small" class="py-2">
    <Steps.Step
      v-for="p in PHASES"
      :key="p.key"
      :status="stepStatus(stages?.[p.key] ?? 'pending')"
      :title="p.label"
      :description="textOf(p.key)"
    />
  </Steps>
</template>
