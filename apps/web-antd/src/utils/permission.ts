import { AdminType } from '#/types/admin';

/**
 * 权限工具类
 */
export const PermissionUtil = {
  /**
   * 检查用户是否有访问指定菜单的权限
   */
  hasMenuPermission(userType: AdminType, menuPath: string): boolean {
    // 系统管理员拥有所有权限
    if (userType === AdminType.SystemAdmin) {
      return true;
    }

    // 定义各角色的菜单白名单
    const menuWhiteList: Record<AdminType, string[]> = {
      [AdminType.SystemAdmin]: ['*'], // 所有菜单

      [AdminType.RegularAdmin]: [
        '/dashboard',
        '/AdminList', // 管理员管理(可看到站长和客服)
        '/AdminEdit', // 管理员编辑
        '/AdminEdit/:id', // 管理员编辑(带参数)
        '/RoleList', // 角色管理
        '/RoleEdit', // 角色编辑
        '/ChatPlatformList', // 平台管理
        '/ChatPlatformEdit', // 平台编辑
        '/ChatPlatformEdit/:id', // 平台编辑(带参数)
        '/ChatUserList', // 客户管理
        '/ChatUserDetail', // 客户详情
        '/ChatUserDetail/:id', // 客户详情(带参数)
        '/ChatUserEdit', // 客户编辑
        '/ChatUserEdit/:id', // 客户编辑(带参数)
        '/SessionList', // 会话管理
        '/Statistics', // 数据统计
      ],

      [AdminType.SiteOwner]: [
        '/dashboard',
        '/AdminList', // 客服管理(只能看到自己的客服)
        '/AdminEdit', // 添加客服
        '/AdminEdit/:id', // 编辑客服
        '/ChatPlatformList', // 我的网站管理
        '/ChatPlatformEdit', // 网站编辑
        '/ChatPlatformEdit/:id', // 网站编辑(带参数)
        '/ChatUserList', // 客户管理
        '/ChatUserDetail', // 客户详情
        '/ChatUserDetail/:id', // 客户详情(带参数)
        '/ChatUserEdit', // 客户编辑
        '/ChatUserEdit/:id', // 客户编辑(带参数)
        '/SessionList', // 会话管理
        '/ConfigList', // 配置管理(分配规则等)
        '/Statistics', // 数据统计
      ],

      [AdminType.CustomerService]: [
        '/dashboard',
        '/SessionList', // 会话管理
        '/ChatUserList', // 客户管理(只读)
        '/ChatUserDetail', // 客户详情
        '/ChatUserDetail/:id', // 客户详情(带参数)
        '/MyStatistics', // 我的统计
      ],
    };

    const allowedMenus = menuWhiteList[userType] || [];

    // 检查是否在白名单中
    if (allowedMenus.includes('*')) {
      return true;
    }

    // 精确匹配
    if (allowedMenus.includes(menuPath)) {
      return true;
    }

    // 动态路由匹配(例如 /AdminEdit/:id)
    return allowedMenus.some((pattern) => {
      if (pattern.includes(':')) {
        const regex = new RegExp(
          '^' + pattern.replaceAll(/:\w+/g, '[^/]+') + '$',
        );
        return regex.test(menuPath);
      }
      return false;
    });
  },

  /**
   * 检查用户是否有执行指定操作的权限
   */
  hasActionPermission(userType: AdminType, action: string): boolean {
    // 系统管理员拥有所有权限
    if (userType === AdminType.SystemAdmin) {
      return true;
    }

    // 定义操作权限
    const actionPermissions: Record<string, AdminType[]> = {
      // 管理员管理
      'admin:add': [AdminType.RegularAdmin, AdminType.SiteOwner],
      'admin:edit': [AdminType.RegularAdmin, AdminType.SiteOwner],
      'admin:delete': [AdminType.RegularAdmin, AdminType.SiteOwner],
      'admin:resetPassword': [AdminType.RegularAdmin, AdminType.SiteOwner],

      // 客户管理
      'chatuser:view': [
        AdminType.RegularAdmin,
        AdminType.SiteOwner,
        AdminType.CustomerService,
      ],
      'chatuser:edit': [
        AdminType.RegularAdmin,
        AdminType.SiteOwner,
        AdminType.CustomerService,
      ],
      'chatuser:delete': [], // 只有系统管理员可以删除客户

      // 平台管理
      'platform:add': [AdminType.RegularAdmin, AdminType.SiteOwner],
      'platform:edit': [AdminType.RegularAdmin, AdminType.SiteOwner],
      'platform:delete': [AdminType.RegularAdmin, AdminType.SiteOwner],

      // 配置管理
      'config:assignRule': [AdminType.RegularAdmin, AdminType.SiteOwner],

      // 角色管理
      'role:add': [AdminType.RegularAdmin],
      'role:edit': [AdminType.RegularAdmin],
      'role:delete': [AdminType.RegularAdmin],
    };

    const allowedRoles = actionPermissions[action] || [];
    return allowedRoles.includes(userType);
  },

  /**
   * 检查数据范围权限
   */
  getDataScope(userType: AdminType): 'all' | 'self' | 'subordinate' {
    const scopeMap: Record<AdminType, 'all' | 'self' | 'subordinate'> = {
      [AdminType.SystemAdmin]: 'all',
      [AdminType.RegularAdmin]: 'all',
      [AdminType.SiteOwner]: 'subordinate',
      [AdminType.CustomerService]: 'subordinate',
    };
    return scopeMap[userType] || 'self';
  },
};
