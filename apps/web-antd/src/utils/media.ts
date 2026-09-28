/**
 * 媒体 URL 工具
 *
 * 背景（契约 §5.4）：后端把文件写在 `media_root` 下（默认 /root/DramaFlow/media），
 * 而 `/storage/media` 由 **nginx / vite 反代**到 `media_root`（后端本身不提供 /storage，
 * 框架的 UseStaticFiles 只映射 wwwroot）。
 *
 * 因此正确 URL = `/storage/media` + 「相对 media_root 的路径部分」。
 *
 * 曾经的问题：各组件各自实现，且都假设路径里含 `/media/` 字面量 ——
 *   - 若运维把 media_root 改成 /mnt/storage（不含 media 字样），URL 会变成空串，图片/视频静默不显示
 *   - media_root 带尾斜杠时会拼出 `/storage/media//...` 双斜杠
 * 统一到此工具，按「已知 media_root 前缀」剥离，既不依赖目录名，也容忍尾斜杠。
 */

/** 与后端 SystemSetting `media_root` 默认值一致；如需变更，改后端设置即可，此处仅作兜底 */
export const DEFAULT_MEDIA_ROOT = '/root/DramaFlow/media';

/**
 * 绝对路径 → 可访问的 /storage URL。
 *
 * @param absPath 后端返回的绝对路径（如 `/root/DramaFlow/media/tasks/12/v1/candidate_0.png`）
 * @param mediaRoot 当前 media_root（来自 SystemSetting，缺省用 DEFAULT_MEDIA_ROOT）
 * @returns 可访问 URL；无法解析时返回空串（调用方据此显示占位）
 */
export function toStorageUrl(
  absPath?: null | string,
  mediaRoot: string = DEFAULT_MEDIA_ROOT,
): string {
  if (!absPath) return '';

  const normalizedRoot = mediaRoot.replace(/\/+$/, '');
  let relative = absPath;

  if (normalizedRoot && absPath.startsWith(`${normalizedRoot}/`)) {
    relative = absPath.slice(normalizedRoot.length + 1);
  } else if (normalizedRoot && absPath === normalizedRoot) {
    return '';
  } else {
    // 路径不以当前 media_root 开头：兼容历史数据/配置漂移 ——
    // 退化为「定位已知的媒体子目录」策略（tasks/ 或 dramafloow/ 之后的部分）。
    const anchors = ['/tasks/', '/dramafloow/'];
    const hit = anchors.find((a) => absPath.includes(a));
    if (!hit) return '';
    relative = absPath.slice(absPath.indexOf(hit) + 1);
  }

  // 去掉可能的前导斜杠，再用单个斜杠拼接，避免出现双斜杠
  return `/storage/media/${relative.replace(/^\/+/, '')}`;
}
