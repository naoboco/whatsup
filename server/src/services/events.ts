import { EventEmitter } from 'node:events';

export type AppEvent =
  | { type: 'message:new'; conversationId: string; messageId: string }
  | { type: 'message:updated'; conversationId: string; messageId: string }
  | { type: 'conversation:updated'; conversationId: string }
  | { type: 'conversations:changed' }
  | { type: 'reminder:updated'; reminderId: string }
  | { type: 'notify'; title: string; body: string; conversationId?: string; tag?: string; category: 'news' | 'jobs' | 'reminders' };

class Bus extends EventEmitter {
  publish(e: AppEvent) { this.emit('event', e); }
}
export const bus = new Bus();
bus.setMaxListeners(100);
