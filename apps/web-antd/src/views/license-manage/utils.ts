/**
 * 根据授权记录的 ClientKey / HardwareId 实际绑定情况推导验证模式。
 *
 * VerifyMode 字段在后端 LicenseManageService 已废弃（不再写入实际值，恒为默认 Both），
 * 早期的列表展示直接读 row.verifyMode 在新数据上恒显示「未知」（枚举序列化为字符串后
 * 数字 map 失配）。改为基于实际绑定字段推导，与运行时验证行为保持一致。
 */
export function deriveVerifyMode(
  row: { clientKey?: null | string; hardwareId?: null | string } | null | undefined,
): { color: string; text: string } {
  const hasClientKey = !!row?.clientKey;
  const hasHardwareId = !!row?.hardwareId;
  if (hasClientKey && hasHardwareId)
    return { text: '双验证（ClientKey + HardwareId）', color: 'purple' };
  if (hasClientKey) return { text: '仅 ClientKey', color: 'blue' };
  if (hasHardwareId) return { text: '仅 HardwareId', color: 'blue' };
  return { text: '未绑定（任意客户端）', color: 'orange' };
}
