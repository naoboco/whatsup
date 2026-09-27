export type ServerEvent =
  | { type: 'message:new' | 'message:updated'; conversationId: string; messageId: string }
  | { type: 'conversation:updated'; conversationId: string }
  | { type: 'conversations:changed' }
  | { type: 'reminder:updated'; reminderId: string }
  | { type: 'notify'; title: string; body: string; conversationId?: string; category: string };

type Fn = (e: ServerEvent) => void;
const fns = new Set<Fn>();
export const onServerEvent = (fn: Fn) => { fns.add(fn); return () => { fns.delete(fn); }; };
export const emitServerEvent = (e: ServerEvent) => fns.forEach(f => f(e));
