import { api } from '#/api/request';

// ==================== SMTP 配置 ====================

export async function getEmailConfig() {
  return api.get('/EmailConfig/GetConfig');
}

export async function saveEmailConfig(data: any) {
  return api.post('/EmailConfig/SaveConfig', data);
}

// ==================== 邮件模板 ====================

export async function getEmailTemplates(page = 1, pageSize = 20) {
  return api.get('/EmailConfig/GetTemplates', { params: { page, pageSize } });
}

export async function getEmailTemplate(id: number) {
  return api.get('/EmailConfig/GetTemplate', { params: { id } });
}

export async function saveEmailTemplate(data: any) {
  return api.post('/EmailConfig/SaveTemplate', data);
}

// ==================== 邮件日志 ====================

export async function getEmailLogs(page = 1, pageSize = 20, status?: number) {
  return api.get('/EmailConfig/GetLogs', {
    params: { page, pageSize, status },
  });
}

export async function getEmailLog(id: number) {
  return api.get('/EmailConfig/GetLog', { params: { id } });
}
