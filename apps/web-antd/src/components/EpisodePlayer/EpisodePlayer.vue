<script lang="ts" setup>
/**
 * EpisodePlayer —— 成片播放器 + 封面（契约 §8 product 视图）
 *
 * 后端返回绝对路径（media_root/...），本地经 /storage 反代访问。
 * ffmpeg 抽取的封面为 jpg，成片为 mp4。
 */
import { computed } from 'vue';

import { Empty, Tag } from 'ant-design-vue';

interface Props {
  videoPath?: null | string;
  coverPath?: null | string;
  episodeNo?: number;
  durationSec?: null | number;
  sizeBytes?: null | number;
  status?: string;
}

const props = withDefaults(defineProps<Props>(), {
  videoPath: null,
  coverPath: null,
  episodeNo: 1,
  durationSec: null,
  sizeBytes: null,
  status: '',
});

/** 绝对路径 → /storage 可访问 URL（取 media_root 之后的相对段） */
function toStorageUrl(abs?: null | string): string {
  if (!abs) return '';
  const marker = '/media/';
  const i = abs.indexOf(marker);
  // media_root 默认 /root/DramaFlow/media：截取 media 之后的路径拼 /storage/media
  return i === -1 ? '' : `/storage${abs.slice(i)}`;
}

const videoUrl = computed(() => toStorageUrl(props.videoPath));
const coverUrl = computed(() => toStorageUrl(props.coverPath));

const sizeText = computed(() => {
  const b = props.sizeBytes ?? 0;
  if (!b) return '-';
  const mb = b / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
});

function fmtDuration(sec?: null | number): string {
  if (!sec) return '-';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="!videoUrl">
      <Empty description="尚未生成成片" />
    </div>

    <template v-else>
      <video
        :src="videoUrl"
        :poster="coverUrl"
        controls
        preload="metadata"
        class="w-full max-w-2xl rounded-md bg-black"
      />
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span>第 {{ episodeNo }} 集</span>
        <span>时长 {{ fmtDuration(durationSec) }}</span>
        <span>大小 {{ sizeText }}</span>
        <Tag
          :color="
            status === 'done'
              ? 'success'
              : status === 'failed'
                ? 'error'
                : 'processing'
          "
          class="!mr-0"
        >
          {{
            status === 'done'
              ? '已完成'
              : status === 'failed'
                ? '失败'
                : status === 'rendering'
                  ? '渲染中'
                  : status
          }}
        </Tag>
      </div>
    </template>
  </div>
</template>
