/**
 * 剧目详情弹窗的共用格式化工具（分镜 / 素材 / 片段 / 成片 / 剧本集）
 */

/** 秒 → "1:23"；空值返回 "-" */
export function formatDuration(sec?: null | number): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '-';
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 字节 → "1.2 MB" / "2.35 GB"；空值返回 "-" */
export function formatSize(bytes?: null | number): string {
  if (!bytes) return '-';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * 引用字段（characterRefs / assetIds 等）可能是 JSON 数组串、逗号串或数组，
 * 统一拆成字符串数组，过滤空值。
 */
export function toStringList(value?: null | string | string[]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  const raw = String(value).trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      // 非合法 JSON：退化为逗号拆分
    }
  }
  return raw
    .split(/[,，、]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** 素材需求来源中文名 */
export function sourceText(source?: null | string): string {
  if (source === 'storyboard') return '分镜推导';
  if (source === 'extract') return 'LLM 提取';
  if (source === 'manual') return '人工录入';
  return source || '-';
}

/** 无值占位 */
export const EMPTY_TEXT = '-';
