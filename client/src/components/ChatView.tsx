import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw, Info, Send, BellOff, Bell, ListChecks, ChevronDown, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import type { Conversation, ConversationDetail, Message, Status } from '../lib/types';
import { onServerEvent } from '../lib/bus';
import { daySeparator, sameDay, relative, time } from '../lib/format';
import { Avatar, Spinner } from './ui';
import { NewsCard, JobCard, SystemNote } from './Messages';
import { AssistantBubble, FiredReminder } from './ReminderCards';
import InfoPanel from './InfoPanel';
import RemindersPanel from './RemindersPanel';
import type { Toast } from './Toasts';

type ToastFn = (t: Omit<Toast, 'id'>) => void;
const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'news', label: 'Actualités' },
  { id: 'jobs', label: 'Emplois' },
  { id: 'unread', label: 'Non lus' },
];
const EXAMPLES = ['Rappelle-moi de postuler chez Mobileye demain à 18 h', 'Rappelle-moi tous les dimanches à 9 h de consulter les offres', 'Liste mes rappels'];

export default function ChatView({ id, listItem, onBack, onOpen, toast, status, onDeleted }: {
  id: string; listItem: Conversation | null; onBack: () => void; onOpen: (id: string) => void; toast: ToastFn; status: Status | null; onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [panel, setPanel] = useState<'info' | 'reminders' | null>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const openedAt = useRef(new Date().toISOString());
  const unreadAtOpen = useRef<Set<string> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);
  const stick = useRef(true);
  const heightBefore = useRef<number | null>(null);
  const isReminders = (detail?.kind ?? listItem?.kind) === 'reminders';

  const loadDetail = useCallback(() => api.conversation(id).then(setDetail).catch(e => setError(e.message)), [id]);

  const loadLatest = useCallback(async (f = filter) => {
    try {
      const r = await api.messages(id, f, { since: openedAt.current });
      if (unreadAtOpen.current === null) unreadAtOpen.current = new Set(r.messages.filter(m => !m.read_at).map(m => m.id));
      setMsgs(prev => {
        if (!prev || f !== filterRef.current) return r.messages;
        const map = new Map(prev.map(m => [m.id, m]));
        let added = 0;
        for (const m of r.messages) { if (!map.has(m.id)) added++; map.set(m.id, m); }
        if (added && !stick.current) setNewBelow(n => n + added);
        return [...map.values()].sort((a, b) => a.sort_at === b.sort_at ? a.id.localeCompare(b.id) : a.sort_at.localeCompare(b.sort_at));
      });
      setCursor(c => (c === null || f !== filterRef.current ? r.nextCursor : c));
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [id, filter]);
  const filterRef = useRef(filter);

  useEffect(() => { loadDetail(); }, [loadDetail]);
  useEffect(() => {
    filterRef.current = filter;
    setMsgs(null); setCursor(null); firstPaint.current = true;
    loadLatest(filter);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Marquer comme lu peu après l'ouverture (le séparateur « non lus » reste affiché pendant la visite)
  useEffect(() => {
    const t = setTimeout(() => { api.markRead(id).catch(() => {}); }, 1200);
    return () => clearTimeout(t);
  }, [id]);

  // Temps réel
  useEffect(() => onServerEvent(e => {
    if ((e.type === 'message:new' || e.type === 'message:updated') && e.conversationId === id) {
      loadLatest();
      if (e.type === 'message:new' && document.visibilityState === 'visible') setTimeout(() => api.markRead(id).catch(() => {}), 800);
    }
    if (e.type === 'conversation:updated' && e.conversationId === id) loadDetail();
    if (e.type === 'reminder:updated' && isReminders) loadLatest();
  }), [id, loadLatest, loadDetail, isReminders]);

  // Défilement : bas de la conversation (ou séparateur des non-lus) au premier affichage, conservation de la position au chargement de l'historique
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !msgs) return;
    if (heightBefore.current !== null) { el.scrollTop = el.scrollHeight - heightBefore.current; heightBefore.current = null; return; }
    if (firstPaint.current) {
      firstPaint.current = false;
      const sep = el.querySelector('.unread-sep') as HTMLElement | null;
      el.scrollTop = sep && filter === 'all' ? sep.offsetTop - 80 : el.scrollHeight;
      return;
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, filter]);

  const onScroll = () => {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current) setNewBelow(0);
    if (el.scrollTop < 120 && cursor && !loadingOlder) loadOlder();
  };

  const loadOlder = async () => {
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const r = await api.messages(id, filter, { before: cursor, since: openedAt.current });
      heightBefore.current = scroller.current!.scrollHeight;
      setMsgs(prev => [...r.messages, ...(prev ?? []).filter(m => !r.messages.some(x => x.id === m.id))]);
      setCursor(r.nextCursor);
    } catch (e: any) { toast({ title: 'Chargement impossible', body: e.message, tone: 'error' }); }
    finally { setLoadingOlder(false); }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.refresh(id);
      const ok = r.filter(x => x.ok), ko = r.filter(x => !x.ok);
      const n = ok.reduce((s, x) => s + (x.inserted ?? 0), 0);
      toast({ title: 'Collecte terminée', body: `${n} nouveauté(s)${ko.length ? ` — ${ko.length} source(s) en erreur : ${ko.map(k => k.error).join(' ; ')}` : ''}`, tone: ko.length ? 'error' : 'info' });
      loadDetail();
    } catch (e: any) { toast({ title: 'Collecte impossible', body: e.message, tone: 'error' }); }
    finally { setRefreshing(false); }
  };

  const send = async (text = draft) => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); stick.current = true;
    try { await api.sendReminderText(t); setDraft(''); }
    catch (e: any) { toast({ title: 'Envoi impossible', body: e.message, tone: 'error' }); }
    finally { setSending(false); }
  };

  const toggleMute = async () => {
    if (!detail) return;
    await api.patchConversation(id, { muted: !detail.muted });
    loadDetail();
  };

  const name = detail?.name ?? listItem?.name ?? '';
  const failing = detail?.sources.filter(s => s.enabled && s.last_error) ?? [];
  const lastFetch = detail?.sources.map(s => s.last_fetched_at).filter(Boolean).sort().pop() ?? null;
  const subtitle = isReminders
    ? (status?.openai ? 'Assistant OpenAI · fuseau ' + (status?.timezone ?? '') : 'Analyseur local · fuseau ' + (status?.timezone ?? ''))
    : detail ? `${detail.sources.length} source(s) · collecte ${relative(lastFetch)}` : '';

  const unreadSet = unreadAtOpen.current;
  const firstUnreadIdx = useMemo(() => (msgs && unreadSet ? msgs.findIndex(m => unreadSet.has(m.id)) : -1), [msgs, unreadSet]);
  const unreadCount = unreadSet?.size ?? 0;

  return (
    <section className="chat" aria-label={`Conversation ${name}`}>
      <header className="chat-head">
        <button className="icon-btn back" onClick={onBack} aria-label="Retour"><ArrowLeft size={20} /></button>
        <button className="chat-title" onClick={() => !isReminders && setPanel(panel === 'info' ? null : 'info')}>
          <Avatar name={name} accent={detail?.accent ?? listItem?.accent ?? '#888'} kind={detail?.kind ?? listItem?.kind ?? 'company'} size={40} />
          <span>
            <span className="t-name">{name}</span>
            <span className={`t-sub ${failing.length ? 'warn' : ''}`}>{failing.length ? <><AlertTriangle size={12} /> {failing.length} source(s) en erreur</> : subtitle}</span>
          </span>
        </button>
        <div className="head-actions">
          {isReminders
            ? <button className="icon-btn" onClick={() => setPanel(panel === 'reminders' ? null : 'reminders')} aria-label="Rappels programmés" title="Rappels programmés"><ListChecks size={20} /></button>
            : <>
                <button className="icon-btn" onClick={refresh} disabled={refreshing} aria-label="Actualiser" title="Collecter maintenant"><RefreshCw size={19} className={refreshing ? 'spin' : ''} /></button>
                <button className="icon-btn hide-sm" onClick={toggleMute} aria-label={detail?.muted ? 'Réactiver les notifications' : 'Mettre en silencieux'} title={detail?.muted ? 'Réactiver les notifications' : 'Silencieux'}>{detail?.muted ? <BellOff size={19} /> : <Bell size={19} />}</button>
                <button className="icon-btn" onClick={() => setPanel(panel === 'info' ? null : 'info')} aria-label="Sources et réglages" title="Sources et réglages"><Info size={19} /></button>
              </>}
        </div>
      </header>

      {!isReminders && (
        <div className="chips chat-chips" role="tablist" aria-label="Filtrer les messages">
          {FILTERS.map(f => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}{f.id === 'news' && detail ? ` · ${detail.counts.news}` : f.id === 'jobs' && detail ? ` · ${detail.counts.jobs}` : ''}
            </button>
          ))}
        </div>
      )}

      {detail && detail.counts.demo > 0 && (
        <div className="banner demo">
          <strong>Démonstration :</strong> <span>messages fictifs, sans lien.</span><span className="demo-long"> Aucune source réelle n’a encore répondu ; ils disparaîtront dès la première collecte réussie.</span>
          <button className="link-btn" onClick={() => setPanel('info')}>État des sources</button>
        </div>
      )}

      <div className="chat-body">
        <div className="messages" ref={scroller} onScroll={onScroll}>
          {loadingOlder && <div className="older"><Spinner /></div>}
          {!loadingOlder && cursor && msgs && <button className="older btn ghost" onClick={loadOlder}>Messages plus anciens</button>}
          {error && !msgs && <div className="empty"><p>{error}</p><button className="btn" onClick={() => loadLatest()}>Réessayer</button></div>}
          {!msgs && !error && (
            <div className="msg-skeletons">{[0, 1, 2].map(i => <div key={i} className="bubble card skeleton"><span /><span /><span /></div>)}</div>
          )}
          {msgs && msgs.length === 0 && (
            <div className="empty chat-empty">
              {filter === 'jobs' ? <p>Aucune offre d’emploi pour cette veille. Ajoutez une source d’emplois (Lever, Greenhouse, SmartRecruiters) dans la fiche.</p>
                : filter === 'news' ? <p>Aucune actualité pour l’instant.</p>
                : filter === 'unread' ? <p>Tout est lu. Admirable.</p>
                : detail && detail.sources.length === 0 && !isReminders ? <p>Cette veille n’a aucune source. Ouvrez la fiche pour en ajouter une.</p>
                : <p>Rien pour l’instant. La prochaine collecte apportera les nouveautés ici.</p>}
            </div>
          )}
          {msgs?.map((m, i) => {
            const prev = msgs[i - 1];
            const unread = !!unreadSet?.has(m.id);
            return (
              <div key={m.id} className={`msg-row ${m.kind === "user" ? "mine" : ""}`}>
                {(!prev || !sameDay(prev.sort_at, m.sort_at)) && <div className="day-sep"><span>{daySeparator(m.sort_at)}</span></div>}
                {i === firstUnreadIdx && filter === 'all' && unreadCount > 0 && <div className="unread-sep"><span>{unreadCount} message{unreadCount > 1 ? 's' : ''} non lu{unreadCount > 1 ? 's' : ''}</span></div>}
                {m.kind === 'news' ? <NewsCard m={m} unread={unread} />
                  : m.kind === 'job' ? <JobCard m={m} unread={unread} />
                  : m.kind === 'system' ? <SystemNote m={m} />
                  : m.kind === 'user' ? <div className="bubble mine-bubble"><p>{m.body}</p><div className="card-meta"><span className="stamp">{time(m.sort_at)} ✓</span></div></div>
                  : m.kind === 'assistant' ? <AssistantBubble m={m} toast={toast} onOpen={onOpen} />
                  : <FiredReminder m={m} unread={unread} toast={toast} onOpen={onOpen} />}
              </div>
            );
          })}
        </div>
        {newBelow > 0 && (
          <button className="new-below" onClick={() => { const el = scroller.current!; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); setNewBelow(0); }}>
            <ChevronDown size={16} /> {newBelow} nouveau{newBelow > 1 ? 'x' : ''}
          </button>
        )}
        {panel === 'info' && detail && !isReminders && (
          <InfoPanel detail={detail} onClose={() => setPanel(null)} reload={loadDetail} toast={toast} onDeleted={onDeleted} />
        )}
        {panel === 'reminders' && isReminders && <RemindersPanel onClose={() => setPanel(null)} toast={toast} />}
      </div>

      {isReminders && (
        <footer className="composer">
          {msgs && msgs.filter(m => m.kind === 'user').length === 0 && (
            <div className="examples">{EXAMPLES.map(e => <button key={e} className="chip" onClick={() => setDraft(e)}>{e}</button>)}</div>
          )}
          <form onSubmit={e => { e.preventDefault(); send(); }}>
            <textarea
              value={draft} onChange={e => setDraft(e.target.value)} rows={1} maxLength={1000}
              placeholder="Ex. : Rappelle-moi de postuler chez Mobileye demain à 18 h"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              aria-label="Votre demande de rappel"
            />
            <button className="send" type="submit" disabled={!draft.trim() || sending} aria-label="Envoyer">{sending ? <Spinner /> : <Send size={19} />}</button>
          </form>
        </footer>
      )}
    </section>
  );
}
