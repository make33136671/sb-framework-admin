import { api } from '#/api/request';

export function getOverview() {
  return api.get('/Dashboard/Overview');
}

export function getMemberTrend(days = 30) {
  return api.get('/Dashboard/MemberTrend', { params: { days } });
}

export function getMemberDistribution() {
  return api.get('/Dashboard/MemberDistribution');
}

export function getRecentLogins(limit = 10) {
  return api.get('/Dashboard/RecentLogins', { params: { limit } });
}

export function getRecentMembers(limit = 10) {
  return api.get('/Dashboard/RecentMembers', { params: { limit } });
}

export function getPendingRealNames(limit = 10) {
  return api.get('/Dashboard/PendingRealNames', { params: { limit } });
}

export function getLoginTrend(days = 7) {
  return api.get('/Dashboard/LoginTrend', { params: { days } });
}
