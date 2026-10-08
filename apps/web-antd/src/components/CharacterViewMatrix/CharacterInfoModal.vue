<script lang="ts" setup>
import type { CharacterMatrixRow } from '#/api/core/dramafloow';

/**
 * CharacterInfoModal —— 角色信息弹窗（用户 2026-10-07 要求）
 *
 * > 「在角色视图 点击那个名字 显示角色的 信息 角色信息可以修改 底下是7视图」
 *
 * ## 结构
 *
 * ```
 * ┌─────────────────────────────────────┐
 * │ 角色名 [可改]                        │  ← 上半：角色信息（可改可存）
 * │ 角色描述（7 视图共享的事实源）[可改]  │
 * │                        [保存]        │
 * ├─────────────────────────────────────┤
 * │ 7 视图缩略图（每格显示当前定稿图）    │  ← 下半：7 视图
 * └─────────────────────────────────────┘
 * ```
 *
 * ## 两个必须守住的点
 *
 * 1. **保存要一次改全 7 行**：一个角色在库里是 7 行需求（每视图一行），
 *    描述共享。若前端循环调单条接口，只改一行的话另外 6 个视图出图仍用旧描述
 *    —— 现象是"改了描述只有某个视图生效"，且不报错。故走后端 `assetSaveCharacter`
 *    （它按角色名定位全部 7 行一起更新）。
 *
 * 2. **改名要同步迁 key**：key 形如 `character_{名}__{视图}`，
 *    名字变了 key 不跟着变，界面按 key 反推名字时就会一直显示旧名。后端做了迁移。
 */
import { computed, ref, watch } from 'vue';

import { Alert, Button, Image, Input, Modal, Tag } from 'ant-design-vue';

import { assetSaveCharacter } from '#/api/core/dramafloow';
import { toStorageUrl } from '#/utils/media';

const props = defineProps<{
  dramaId: number;
  /** 矩阵里的一行（一个角色）；null = 关闭 */
  row: CharacterMatrixRow | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 保存成功 → 父组件刷新矩阵 */
  (e: 'saved'): void;
  /** 点某个视图格子 → 打开该视图的选图/生成弹窗 */
  (e: 'openView', payload: { row: CharacterMatrixRow; suffix: string }): void;
}>();

const open = computed(() => props.row !== null);

const nameDraft = ref('');
const descDraft = ref('');
const saving = ref(false);

/** 库中值（用于判断是否改过） */
const savedName = ref('');
const savedDesc = ref('');

const dirty = computed(
  () =>
    nameDraft.value.trim() !== savedName.value.trim() ||
    descDraft.value.trim() !== savedDesc.value.trim(),
);

watch(
  () => props.row,
  (row) => {
    if (!row) return;
    savedName.value = row.name;
    savedDesc.value = row.description ?? '';
    nameDraft.value = row.name;
    descDraft.value = row.description ?? '';
  },
  { immediate: true },
);

/** 视图格子（固定 7 个，顺序由后端决定） */
const views = computed(() => props.row?.views ?? []);

/**
 * 该视图已定稿的候选图 → 可显示的 URL。
 *
 * ⚠️ 必须过 `toStorageUrl`：候选的 `filePath` 是**服务端绝对路径**
 *    （如 `/data/media/dramafloow/xxx.png`），直接塞进 `<img src>` 浏览器会当成
 *    相对本站的路径去请求 → 必然 404 → **图片裂开**
 *    （2026-10-07 用户报障「底下的7视图 图片是裂了的」就是这个原因）。
 *    `toStorageUrl` 负责把它转成 nginx 直读的 `/storage/...`。
 */
function previewOf(requirementId?: null | number) {
  if (!props.row || !requirementId) return null;
  // 优先取该需求的**定稿**候选（approvedAssetId），没有才退回任意一张有图的候选。
  // 为什么优先定稿：7 视图格子的语义是"这个视图现在用哪张图"，
  // 随便取一张可能拿到已被驳回的废图，用户会以为"这就是当前效果"。
  const cell = props.row.views.find((v) => v.requirementId === requirementId);
  const approvedId = cell?.approvedAssetId ?? null;
  const approved = approvedId
    ? props.row.candidates.find((c) => c.id === approvedId && c.filePath)
    : null;
  const hit =
    approved ??
    props.row.candidates.find(
      (c) => c.requirementId === requirementId && c.filePath,
    );
  return hit ? toStorageUrl(hit.filePath) : null;
}

async function save() {
  if (!props.row) return;
  if (!nameDraft.value.trim()) {
    return;
  }
  saving.value = true;
  try {
    await assetSaveCharacter({
      dramaId: props.dramaId,
      name: savedName.value,
      newName: nameDraft.value.trim(),
      description: descDraft.value.trim(),
    });
    savedName.value = nameDraft.value.trim();
    savedDesc.value = descDraft.value.trim();
    emit('saved');
  } catch {
    // 拦截器已提示
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal
    :footer="null"
    :open="open"
    :width="720"
    :title="row ? `角色信息 —— ${savedName}` : '角色信息'"
    @cancel="emit('close')"
  >
    <template v-if="row">
      <!-- 上半：角色信息（可改可存） -->
      <div class="mb-4">
        <div class="mb-1 text-sm">角色名</div>
        <Input v-model:value="nameDraft" placeholder="角色名" />

        <div class="mb-1 mt-3 flex items-center justify-between">
          <span class="text-sm">
            角色描述
            <span class="text-xs text-muted-foreground">
              （7 个视图共享，也是提示词生成的事实源）
            </span>
          </span>
          <Button
            v-if="dirty"
            :loading="saving"
            size="small"
            type="primary"
            @click="save"
          >
            保存
          </Button>
          <span v-else class="text-xs text-muted-foreground">已保存</span>
        </div>
        <Input.TextArea
          v-model:value="descDraft"
          :rows="5"
          placeholder="如：女性，25岁，身高约165cm，纤细匀称；肤色白皙……"
        />
        <div v-if="dirty" class="mt-1 text-xs text-muted-foreground">
          保存会同时更新该角色的全部
          {{ views.length }} 个视图（它们共享这一条描述）。
        </div>
      </div>

      <!-- 下半：7 视图 -->
      <div class="mb-2 text-sm">7 视图</div>
      <div class="grid grid-cols-4 gap-2">
        <div
          v-for="v in views"
          :key="v.suffix"
          class="cursor-pointer rounded border border-border p-1 hover:border-primary"
          @click="emit('openView', { row, suffix: v.suffix })"
        >
          <Image
            v-if="previewOf(v.requirementId)"
            :src="previewOf(v.requirementId)!"
            :height="90"
            class="w-full object-cover"
          />
          <div
            v-else
            class="flex h-[90px] w-full items-center justify-center bg-muted/40 text-xs text-muted-foreground"
          >
            无图
          </div>
          <div class="mt-1 flex items-center justify-between">
            <span class="truncate text-xs">{{ v.label }}</span>
            <Tag v-if="!v.requirementId" class="!mr-0" color="orange">
              未建档
            </Tag>
          </div>
        </div>
      </div>

      <Alert v-if="views.length === 0" class="mt-2" show-icon type="warning">
        <template #message>
          该角色还没有视图需求 —— 请先用「补齐角色视图」建档
        </template>
      </Alert>

      <div class="mt-4 flex justify-end">
        <Button @click="emit('close')">关闭</Button>
      </div>
    </template>
  </Modal>
</template>
