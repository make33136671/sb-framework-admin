/**
 * 管理员角色类型枚举
 */
export enum AdminType {
  SystemAdmin = 0,
  RegularAdmin = 1,
  SiteOwner = 2,
  CustomerService = 3,
}

/**
 * 角色类型标签映射
 */
export const AdminTypeLabels: Record<AdminType, string> = {
  [AdminType.SystemAdmin]: '系统管理员',
  [AdminType.RegularAdmin]: '普通管理员',
  [AdminType.SiteOwner]: '站长',
  [AdminType.CustomerService]: '客服',
};

/**
 * 获取角色类型选项列表（用于下拉选择等组件）
 */
export function getAdminTypeOptions() {
  return Object.entries(AdminTypeLabels).map(([value, label]) => ({
    label,
    value: Number(value),
  }));
}

/**
 * 获取角色类型标签
 * @param type 角色类型
 * @returns 角色类型标签
 */
export function getAdminTypeLabel(type: AdminType): string {
  return AdminTypeLabels[type] || '未知';
}

/**
 * 获取角色类型颜色
 * @param type 角色类型
 * @returns Tag 组件颜色值
 */
export function getAdminTypeColor(
  type: AdminType,
): 'blue' | 'default' | 'green' | 'orange' | 'red' {
  const colors = {
    [AdminType.SystemAdmin]: 'red' as const,
    [AdminType.RegularAdmin]: 'orange' as const,
    [AdminType.SiteOwner]: 'blue' as const,
    [AdminType.CustomerService]: 'green' as const,
  };
  return colors[type] || 'default';
}
