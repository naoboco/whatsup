import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Preferences, Status } from '../lib/types';
import { enablePush, disablePush, currentSubscription, pushSupported } from '../lib/push';
import { Modal, Toggle } from './ui';

export default function Settings({ prefs, status, onClose, onSaved, onStatus, toast }: {
  prefs: Preferences; status: Status; onClose: () => void; onSaved: (p: Preferences) => void; onStatus: () => void; toast: (t: any) => void;
}) {
  const [p, setP] = useState(prefs);
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { currentSubscription().then(s => setPushOn(!!s)).catch(() => setPushOn(false)); }, []);
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setP(x => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    try { onSaved(await api.savePreferences(p)); onClose(); } catch (e: any) { toast({ title: 'Erreur', body: e.message, tone: 'error' }); }
    finally { setBusy(false); }
  };
  const togglePush = async () => {
    try {
      if (pushOn) { await disablePush(); setPushOn(false); }
      else { toast({ title: await enablePush(), body: '', tone: 'info' }); setPushOn(true); }
      onStatus();
    } catch (e: any) { toast({ title: 'Notifications', body: e.message, tone: 'error' }); }
  };

  return (
    <Modal title="Préférences" onClose={onClose} wide>
      <div className="form">
        <fieldset>
          <legend>Notifications sur cet appareil</legend>
          {!pushSupported() ? <p className="hint">Ce navigateur ne gère pas les notifications push. Les bandeaux dans l’application restent actifs.</p> : (
            <div className="row-btns">
              <button className="btn primary" onClick={togglePush} disabled={pushOn === null}>{pushOn ? 'Désactiver sur cet appareil' : 'Activer les notifications'}</button>
              {pushOn && <button className="btn" onClick={() => api.testPush().then(r => toast({ title: 'Test envoyé', body: `${r.sent} appareil(s)`, tone: 'info' }))}>Envoyer un test</button>}
            </div>
          )}
          <p className="hint">{status.pushSubscriptions} appareil(s) abonné(s). Sur iPhone, ajoutez d’abord l’application à l’écran d’accueil.</p>
        </fieldset>
        <fieldset>
          <legend>Quoi notifier</legend>
          <Toggle label="Nouvelles actualités" checked={p.notifyNews} onChange={v => set('notifyNews', v)} />
          <Toggle label="Nouvelles offres d’emploi" checked={p.notifyJobs} onChange={v => set('notifyJobs', v)} />
          <Toggle label="Rappels" checked={p.notifyReminders} onChange={v => set('notifyReminders', v)} />
          <label>Regrouper au-delà de
            <select value={p.groupThreshold} onChange={e => set('groupThreshold', Number(e.target.value))}>
              {[1, 3, 5, 10].map(n => <option key={n} value={n}>{n} nouveauté(s) par collecte</option>)}
            </select>
          </label>
          <p className="hint">Le silencieux se règle aussi par conversation (icône cloche).</p>
        </fieldset>
        <fieldset>
          <legend>Heures calmes</legend>
          <Toggle label="Activer les heures calmes" checked={p.quietHours.enabled} onChange={v => set('quietHours', { ...p.quietHours, enabled: v })} />
          <div className="row">
            <label>Début<input type="time" value={p.quietHours.start} onChange={e => set('quietHours', { ...p.quietHours, start: e.target.value })} /></label>
            <label>Fin<input type="time" value={p.quietHours.end} onChange={e => set('quietHours', { ...p.quietHours, end: e.target.value })} /></label>
          </div>
          <Toggle label="Les rappels passent quand même" hint="Vous les avez demandés, après tout." checked={p.remindersIgnoreQuietHours} onChange={v => set('remindersIgnoreQuietHours', v)} />
        </fieldset>
        <fieldset>
          <legend>Fuseau horaire</legend>
          <label>Fuseau<input value={p.timezone} onChange={e => set('timezone', e.target.value)} placeholder="Asia/Jerusalem" /></label>
          <p className="hint">Appliqué à l’affichage et aux nouveaux rappels.</p>
        </fieldset>
        <fieldset>
          <legend>État du service</legend>
          <ul className="status-list">
            <li><span className={`dot ${status.openai ? 'ok' : 'wait'}`} /> Rappels : {status.openai ? `OpenAI (${status.openaiModel})` : 'analyseur local — ajoutez OPENAI_API_KEY côté serveur'}</li>
            <li><span className={`dot ${status.sources.failing ? 'ko' : 'ok'}`} /> Sources : {status.sources.healthy}/{status.sources.sources} opérationnelle(s){status.sources.failing ? `, ${status.sources.failing} en erreur` : ''}</li>
            <li><span className={`dot ${status.scheduler ? 'ok' : 'ko'}`} /> Planificateur : {status.scheduler ? 'actif' : 'désactivé'}</li>
            <li><span className={`dot ${status.demoMessages ? 'wait' : 'ok'}`} /> Démonstration : mode {status.demoMode}, {status.demoMessages} message(s) fictif(s)</li>
          </ul>
          {status.demoMessages > 0 && <button className="btn" onClick={() => api.clearDemo().then(r => { toast({ title: `${r.deleted} message(s) de démo supprimé(s)`, body: '', tone: 'info' }); onStatus(); })}>Effacer les données de démo</button>}
        </fieldset>
        <div className="form-actions">
          <button className="btn ghost" onClick={onClose}>Fermer</button>
          <button className="btn primary" onClick={save} disabled={busy}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}
