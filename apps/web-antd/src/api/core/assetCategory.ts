/**
 * 素材分类 + 分类视图接口
 *
 * 分类是全局的两层结构（顶层/子分类都能增删改），素材与分类是**多对多**：
 * 一个「张三」可以同时挂在「全局人物形象」和「受伤状态」下。
 */
import { api } from '#/api/request';

/** 分类节点（Tree 返回，children 递归） */
export interface AssetCategoryNode {
  id: number;
  parentId: number;
  name: string;
  kind?: null | string;
  icon?: null | string;
  sortNo: number;
  /** 直接挂在本分类上的素材 id（不含后代分类的） */
  requirementIds: number[];
  children: AssetCategoryNode[];
}

/** 分类视图里的素材条目 */
export interface AssetViewItem {
  id: number;
  key: string;
  /** 展示名（key 去掉种类前缀） */
  name: string;
  kind: string;
  version: number;
  status: string;
  description?: null | string;
  spec?: null | string;
  approvedAssetId?: null | number;
  /** 预览图绝对路径（走 toStorageUrl） */
  previewPath?: null | string;
  candidateCount: number;
  /** 出场集数 */
  episodes: number[];
  /** 所属分类 id（多对多） */
  categoryIds: number[];
}

export async function assetCategoryTree() {
  return api.get<AssetCategoryNode[]>('/AssetCategory/Tree');
}

export async function assetCategorySave(data: {
  id?: number;
  name: string;
  parentId?: number;
  kind?: string;
  icon?: string;
  sortNo?: number;
}) {
  return api.post<{ id: number }>('/AssetCategory/Save', data);
}

export async function assetCategoryDelete(id: number, cascade = false) {
  return api.post('/AssetCategory/Delete', { id, cascade });
}

/** 设置某素材的所属分类（覆盖式，多选） */
export async function assetCategoryAssign(
  requirementId: number,
  categoryIds: number[],
) {
  return api.post('/AssetCategory/Assign', {
    requirementId,
    categoryIds: categoryIds.join(','),
  });
}

/** 某剧目的素材（分类视图：含名称/预览图/出场集数/所属分类） */
export async function assetCategoryRequirements(dramaId: number) {
  return api.get<AssetViewItem[]>('/AssetCategory/Requirements', {
    params: { dramaId },
  });
}
