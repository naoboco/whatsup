export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface LastMessage { id: string; kind: MessageKind; title: string | null; body: string | null; sort_at: string; is_demo: boolean; job_location: string | null }
export interface Conversation {
  id: string; slug: string; name: string; kind: 'company' | 'topic' | 'reminders'; description: string | null; accent: string;
  muted: boolean; pinned: boolean; created_at: string; last_message: LastMessage | null; unread: number; failing_sources: number;
  matches: { id: string; kind: MessageKind; title: string | null; body: string | null; sort_at: string }[] | null;
}
export interface Source {
  id: string; type: string; category: 'news' | 'jobs'; label: string; config: Record<string, unknown>; enabled: boolean; is_demo: boolean;
  interval_minutes: number; last_fetched_at: string | null; last_success_at: string | null; last_error: string | null; last_item_count: number | null;
}
export interface ConversationDetail extends Omit<Conversation, 'last_message' | 'unread' | 'failing_sources' | 'matches'> {
  sources: Source[]; counts: { news: number; jobs: number; demo: number };
}
export type MessageKind = 'news' | 'job' | 'reminder' | 'user' | 'assistant' | 'system';
export interface ReminderInfo {
  id: string; text: string; due_at: string; timezone: string; recurrence: Recurrence; status: 'draft' | 'scheduled' | 'fired' | 'done' | 'cancelled';
  interpreter: 'openai' | 'local' | 'manual'; fire_count: number; related_conversation_id: string | null; related_conversation_name: string | null;
}
export interface Message {
  id: string; conversation_id: string; kind: MessageKind; title: string | null; body: string | null; url: string | null; apply_url: string | null;
  source_name: string | null; source_domain: string | null; source_label: string | null; source_type: string | null;
  published_at: string | null; job_location: string | null; job_department: string | null; job_commitment: string | null;
  payload: Record<string, any>; is_demo: boolean; closed_at: string | null; revised_at: string | null; read_at: string | null;
  sort_at: string; created_at: string; reminder: ReminderInfo | null;
}
export interface Preferences {
  notifyNews: boolean; notifyJobs: boolean; notifyReminders: boolean; groupThreshold: number;
  quietHours: { enabled: boolean; start: string; end: string }; remindersIgnoreQuietHours: boolean; timezone: string;
}
export interface Status {
  openai: boolean; openaiModel: string; demoMode: string; demoMessages: number; sources: { sources: number; failing: number; healthy: number };
  pushSubscriptions: number; timezone: string; scheduler: boolean;
}
export interface ReminderRow { id: string; text: string; due_at: string; timezone: string; recurrence: Recurrence; status: string; interpreter: string; fire_count: number }
