import { computed } from 'vue';

import { useUserStore } from '@vben/stores';

import { AdminType } from '#/types/admin';
import { PermissionUtil } from '#/utils/permission';

/**
 * 权限控制组合式函数
 */
export function usePermission() {
  const userStore = useUserStore();

  const userType = computed<AdminType>(() => {
    return (
      (userStore.userInfo?.adminType as AdminType) ?? AdminType.CustomerService
    );
  });

  /**
   * 检查是否有菜单权限
   */
  const hasMenuPermission = (menuPath: string): boolean => {
    return PermissionUtil.hasMenuPermission(userType.value, menuPath);
  };

  /**
   * 检查是否有操作权限
   */
  const hasPermission = (action: string): boolean => {
    return PermissionUtil.hasActionPermission(userType.value, action);
  };

  /**
   * 检查是否有任意一个权限
   */
  const hasAnyPermission = (actions: string[]): boolean => {
    return actions.some((action) => hasPermission(action));
  };

  /**
   * 检查是否有所有权限
   */
  const hasAllPermissions = (actions: string[]): boolean => {
    return actions.every((action) => hasPermission(action));
  };

  /**
   * 获取数据范围
   */
  const dataScope = computed(() => {
    return PermissionUtil.getDataScope(userType.value);
  });

  /**
   * 是否是系统管理员
   */
  const isSuperAdmin = computed(() => {
    return userType.value === AdminType.SystemAdmin;
  });

  /**
   * 是否是普通管理员
   */
  const isAdmin = computed(() => {
    return userType.value === AdminType.RegularAdmin;
  });

  /**
   * 是否是站长
   */
  const isSiteOwner = computed(() => {
    return userType.value === AdminType.SiteOwner;
  });

  /**
   * 是否是客服
   */
  const isCustomerService = computed(() => {
    return userType.value === AdminType.CustomerService;
  });

  return {
    userType,
    hasMenuPermission,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    dataScope,
    isSuperAdmin,
    isAdmin,
    isSiteOwner,
    isCustomerService,
  };
}
