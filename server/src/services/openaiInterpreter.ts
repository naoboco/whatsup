import { z } from 'zod';
import { DateTime } from 'luxon';
import { config } from '../config.js';

export const Interpretation = z.object({
  intent: z.enum(['create', 'update', 'delete', 'list', 'clarify']),
  text: z.string().max(300).nullable(),
  due_local: z.string().nullable(),
  recurrence: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly']),
  target_reminder_id: z.string().nullable(),
  question: z.string().max(400).nullable(),
});
export type Interpretation = z.infer<typeof Interpretation>;

const SCHEMA = {
  name: 'reminder_interpretation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'text', 'due_local', 'recurrence', 'target_reminder_id', 'question'],
    properties: {
      intent: { type: 'string', enum: ['create', 'update', 'delete', 'list', 'clarify'] },
      text: { type: ['string', 'null'], description: 'Contenu du rappel, reformulé brièvement à l’infinitif, en français. Null si non applicable.' },
      due_local: { type: ['string', 'null'], description: 'Date et heure locales au format YYYY-MM-DDTHH:mm dans le fuseau de l’utilisateur. Null si non applicable.' },
      recurrence: { type: 'string', enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly'] },
      target_reminder_id: { type: ['string', 'null'], description: 'Pour update/delete : identifiant exact d’un rappel existant listé.' },
      question: { type: ['string', 'null'], description: 'Pour clarify : question courte en français.' },
    },
  },
} as const;

export interface InterpretContext {
  now: DateTime;
  reminders: { id: string; text: string; due_local: string; recurrence: string }[];
  conversations: string[];
}

export class OpenAIUnavailable extends Error {}

export const openaiConfigured = () => !!config.openaiApiKey;

function systemPrompt(ctx: InterpretContext) {
  return [
    'Tu es le module d’interprétation des rappels d’une application de veille professionnelle.',
    'Tu ne planifies rien toi-même : tu convertis la demande de l’utilisateur en JSON structuré, que l’application fera confirmer.',
    `Maintenant : ${ctx.now.setLocale('fr').toFormat("cccc d LLLL yyyy, HH:mm")} (fuseau ${ctx.now.zoneName}).`,
    'Règles :',
    '- « demain » = jour civil suivant dans ce fuseau. Si seule l’heure est donnée et qu’elle est passée aujourd’hui, prends demain.',
    '- Sans heure : matin = 09:00, midi = 12:00, après-midi = 15:00, soir = 20:00, sinon 09:00.',
    '- « jours ouvrés » / « en semaine » = recurrence "weekdays" (en Israël : dimanche–jeudi).',
    '- Pour une répétition, due_local est la PREMIÈRE occurrence future.',
    '- update/delete : choisis target_reminder_id UNIQUEMENT parmi la liste fournie ; pour update, renseigne les champs finaux (texte, date, répétition) après modification.',
    '- Si la demande est ambiguë (plusieurs rappels possibles, date introuvable), intent = "clarify" avec une question.',
    '- « liste », « quels rappels » → intent "list".',
    '- text : court, à l’infinitif, sans la date (ex. « Postuler chez Mobileye »).',
    `Veilles suivies (noms d’entreprises/thèmes) : ${ctx.conversations.join(', ') || 'aucune'}.`,
    `Rappels actifs : ${JSON.stringify(ctx.reminders)}`,
  ].join('\n');
}

export async function interpretWithOpenAI(input: string, ctx: InterpretContext): Promise<Interpretation> {
  if (!config.openaiApiKey) throw new OpenAIUnavailable('Clé OPENAI_API_KEY absente');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: SCHEMA },
        messages: [
          { role: 'system', content: systemPrompt(ctx) },
          { role: 'user', content: input.slice(0, 1000) },
        ],
      }),
    });
  } catch (e: any) {
    throw new OpenAIUnavailable(e?.name === 'AbortError' ? 'délai dépassé' : `réseau (${e?.cause?.code ?? e?.message})`);
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const msg = (() => { try { return JSON.parse(body)?.error?.message; } catch { return ''; } })();
    throw new OpenAIUnavailable(`HTTP ${res.status}${msg ? ` — ${String(msg).slice(0, 160)}` : ''}`);
  }
  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new OpenAIUnavailable('réponse vide');
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new OpenAIUnavailable('JSON illisible'); }
  const r = Interpretation.safeParse(parsed);
  if (!r.success) throw new OpenAIUnavailable('JSON non conforme au schéma');
  return r.data;
}
