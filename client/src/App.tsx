import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './lib/api';
import type { Conversation, Preferences, Status } from './lib/types';
import { emitServerEvent, onServerEvent, type ServerEvent } from './lib/bus';
import { setTimeZone } from './lib/format';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import NewConversation from './components/NewConversation';
import Settings from './components/Settings';
import { Toasts, type Toast } from './components/Toasts';
import { Lighthouse } from './components/ui';

const readHash = () => /^#\/c\/([0-9a-f-]{36})/.exec(location.hash)?.[1] ?? null;

export default function App() {
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(readHash());
  const [status, setStatus] = useState<Status | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [modal, setModal] = useState<'new' | 'settings' | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), t.tone === 'error' ? 7000 : 5000);
  }, []);

  const loadList = useCallback(async () => {
    try { setConvs(await api.conversations(q, filter)); setListError(null); setAuthRequired(false); }
    catch (e: any) { if (e.status === 401) { setAuthRequired(true); setListError('Code d’accès incorrect ou manquant.'); } else setListError(e.message); }
  }, [q, filter]);

  const loadStatus = useCallback(() => { api.status().then(setStatus).catch(() => {}); }, []);

  useEffect(() => { const t = setTimeout(loadList, q ? 250 : 0); return () => clearTimeout(t); }, [loadList, q]);
  useEffect(() => {
    loadStatus();
    api.preferences().then(p => { setPrefs(p); setTimeZone(p.timezone); }).catch(() => {});
  }, [loadStatus]);

  // Navigation par hash (bouton retour du téléphone compris)
  useEffect(() => {
    const h = () => setSelected(readHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const open = useCallback((id: string | null) => {
    if (id) { if (readHash() !== id) location.hash = `#/c/${id}`; }
    else if (readHash()) history.length > 1 ? history.back() : (location.hash = '');
  }, []);

  // Temps réel : flux SSE du serveur
  useEffect(() => {
    if (import.meta.env.VITE_SERVERLESS === 'true') return;
    let es: EventSource | null = null, retry: number | undefined;
    const connect = () => {
      es = new EventSource(api.eventsUrl());
      es.onopen = () => setOnline(true);
      es.onerror = () => { setOnline(false); };
      es.onmessage = m => { try { emitServerEvent(JSON.parse(m.data)); } catch { /* ignoré */ } };
    };
    connect();
    return () => { es?.close(); clearTimeout(retry); };
  }, []);

  useEffect(() => {
    if (import.meta.env.VITE_SERVERLESS !== 'true' || authRequired) return;
    const poll = () => { loadList(); loadStatus(); };
    const t = window.setInterval(poll, 20_000);
    const visible = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', visible); };
  }, [loadList, loadStatus, authRequired]);

  useEffect(() => onServerEvent((e: ServerEvent) => {
    if (e.type === 'notify') {
      const here = e.conversationId && e.conversationId === selectedRef.current && document.visibilityState === 'visible';
      if (!here && document.visibilityState === 'visible') toast({ title: e.title, body: e.body, conversationId: e.conversationId, tone: e.category === 'reminders' ? 'reminder' : 'info' });
    }
    if (e.type !== 'notify') { loadList(); if (e.type === 'conversation:updated' || e.type === 'conversations:changed') loadStatus(); }
  }), [loadList, loadStatus, toast]);

  // Messages du service worker (push reçu pendant que l'onglet est au premier plan, clic sur une notification)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const h = (ev: MessageEvent) => {
      if (ev.data?.type === 'open' && ev.data.conversationId) open(ev.data.conversationId);
    };
    navigator.serviceWorker.addEventListener('message', h);
    return () => navigator.serviceWorker.removeEventListener('message', h);
  }, [open]);

  const current = convs?.find(c => c.id === selected) ?? null;

  if (authRequired) return (
    <div className="access-page"><form className="access-card" onSubmit={e => {
      e.preventDefault();
      localStorage.setItem('vigie_token', accessCode.trim());
      setAccessCode('');
      setListError(null);
      loadList();
      loadStatus();
      api.preferences().then(p => { setPrefs(p); setTimeZone(p.timezone); }).catch(() => {});
    }}>
      <Lighthouse size={62} />
      <h1>Vigie</h1>
      <p>Entrez votre code d’accès pour ouvrir votre veille et vos rappels.</p>
      <label htmlFor="access-code">Code d’accès</label>
      <input id="access-code" type="password" autoComplete="current-password" value={accessCode} onChange={e => setAccessCode(e.target.value)} required />
      {listError && <p className="access-error" role="alert">{listError}</p>}
      <button className="btn primary" type="submit">Ouvrir l’application</button>
    </form></div>
  );

  return (
    <div className={`app ${selected ? 'has-selection' : ''}`}>
      <Sidebar
        convs={convs} error={listError} q={q} setQ={setQ} filter={filter} setFilter={setFilter}
        selected={selected} onOpen={open} onNew={() => setModal('new')} onSettings={() => setModal('settings')}
        status={status} online={online} onRetry={loadList}
      />
      <main className="pane">
        {selected ? (
          <ChatView key={selected} id={selected} listItem={current} onBack={() => open(null)} onOpen={open} toast={toast} status={status}
            onDeleted={() => { open(null); loadList(); }} />
        ) : (
          <div className="welcome">
            <Lighthouse size={88} />
            <h1>Vigie</h1>
            <p>Chaque entreprise suivie a sa conversation. Les actualités et les offres d’emploi y arrivent comme des messages, avec leur source d’origine.</p>
            <p className="muted small">Sélectionnez une conversation, ou ajoutez une veille.</p>
            <button className="btn primary" onClick={() => setModal('new')}>Nouvelle veille</button>
          </div>
        )}
      </main>
      {modal === 'new' && <NewConversation onClose={() => setModal(null)} onCreated={c => { setModal(null); loadList(); open(c.id); toast({ title: 'Veille créée', body: `${c.name} : première collecte en cours.`, tone: 'info' }); }} />}
      {modal === 'settings' && prefs && status && (
        <Settings prefs={prefs} status={status} onClose={() => setModal(null)}
          onSaved={p => { setPrefs(p); setTimeZone(p.timezone); toast({ title: 'Préférences enregistrées', body: '', tone: 'info' }); }}
          onStatus={loadStatus} toast={toast} />
      )}
      <Toasts items={toasts} onOpen={id => open(id)} onClose={id => setToasts(ts => ts.filter(t => t.id !== id))} />
    </div>
  );
}
