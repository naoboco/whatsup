import type { Conversation, ConversationDetail, Message, Preferences, Status, ReminderRow } from './types';

function token(): string {
  try { return localStorage.getItem('vigie_token') ?? ''; } catch { return ''; }
}

export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t = token(); if (t) headers.Authorization = `Bearer ${t}`;
  let res: Response;
  try { res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError('Serveur injoignable', 0); }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ? `${data.error}${data.details ? ' — ' + data.details.join(' ; ') : ''}` : `Erreur ${res.status}`, res.status);
  return data as T;
}

export const api = {
  status: () => req<Status>('GET', '/status'),
  conversations: (q = '', filter = 'all') => req<Conversation[]>('GET', `/conversations?q=${encodeURIComponent(q)}&filter=${filter}`),
  conversation: (id: string) => req<ConversationDetail>('GET', `/conversations/${id}`),
  createConversation: (body: unknown) => req<Conversation>('POST', '/conversations', body),
  patchConversation: (id: string, body: unknown) => req('PATCH', `/conversations/${id}`, body),
  deleteConversation: (id: string) => req('DELETE', `/conversations/${id}`),
  markRead: (id: string) => req('POST', `/conversations/${id}/read`),
  refresh: (id: string) => req<{ source: string; ok: boolean; inserted?: number; error?: string }[]>('POST', `/conversations/${id}/refresh`),
  messages: (id: string, filter: string, opts: { before?: string; since?: string } = {}) =>
    req<{ messages: Message[]; nextCursor: string | null }>('GET', `/conversations/${id}/messages?filter=${filter}${opts.before ? `&before=${encodeURIComponent(opts.before)}` : ''}${opts.since ? `&since=${encodeURIComponent(opts.since)}` : ''}`),
  addSource: (id: string, body: unknown) => req<{ firstFetch: { ok: boolean; error?: string; inserted?: number } }>('POST', `/conversations/${id}/sources`, body),
  patchSource: (id: string, body: unknown) => req('PATCH', `/sources/${id}`, body),
  deleteSource: (id: string) => req('DELETE', `/sources/${id}`),
  refreshSource: (id: string) => req<{ ok: boolean; error?: string; inserted?: number }>('POST', `/sources/${id}/refresh`),
  sendReminderText: (text: string) => req('POST', '/reminders/messages', { text }),
  resolve: (messageId: string, decision: 'confirm' | 'cancel') => req('POST', `/assistant/${messageId}/${decision}`),
  reminders: (status: 'active' | 'all' = 'active') => req<ReminderRow[]>('GET', `/reminders?status=${status}`),
  patchReminder: (id: string, body: unknown) => req('PATCH', `/reminders/${id}`, body),
  deleteReminder: (id: string) => req('DELETE', `/reminders/${id}`),
  doneReminder: (id: string) => req('POST', `/reminders/${id}/done`),
  snoozeReminder: (id: string, minutes: number) => req('POST', `/reminders/${id}/snooze`, { minutes }),
  preferences: () => req<Preferences>('GET', '/preferences'),
  savePreferences: (p: Partial<Preferences>) => req<Preferences>('PUT', '/preferences', p),
  clearDemo: () => req<{ deleted: number }>('POST', '/demo/clear'),
  pushKey: () => req<{ publicKey: string }>('GET', '/push/public-key'),
  subscribe: (sub: PushSubscriptionJSON) => req('POST', '/push/subscribe', sub),
  unsubscribe: (endpoint: string) => req('POST', '/push/unsubscribe', { endpoint }),
  testPush: () => req<{ sent: number; failed: number }>('POST', '/push/test'),
  eventsUrl: () => `/api/events${token() ? `?token=${encodeURIComponent(token())}` : ''}`,
};
