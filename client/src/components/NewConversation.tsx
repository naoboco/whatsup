import { useState } from 'react';
import { api } from '../lib/api';
import type { Conversation } from '../lib/types';
import { Modal } from './ui';

export default function NewConversation({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Conversation) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'company' | 'topic'>('company');
  const [description, setDescription] = useState('');
  const [gdelt, setGdelt] = useState(true);
  const [query, setQuery] = useState('');
  const [rss, setRss] = useState('');
  const [jobsType, setJobsType] = useState('');
  const [jobsId, setJobsId] = useState('');
  const [leverEu, setLeverEu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const sources: any[] = [];
    if (gdelt) sources.push({ type: 'gdelt', config: { query: query.trim() || `"${name.trim()}"` } });
    for (const url of rss.split(/\s+/).filter(Boolean)) sources.push({ type: 'rss', config: { url } });
    if (jobsType && jobsId) {
      const cfg = jobsType === 'lever' ? { site: jobsId, region: leverEu ? 'eu' : 'global', publisher: `${name} — carrières` }
        : jobsType === 'greenhouse' ? { board: jobsId, publisher: `${name} — carrières` } : { company: jobsId, publisher: `${name} — carrières` };
      sources.push({ type: jobsType, config: cfg });
    }
    setBusy(true);
    try { onCreated(await api.createConversation({ name: name.trim(), kind, description: description.trim() || undefined, sources })); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Nouvelle veille" onClose={onClose}>
      <form className="form" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="seg" role="radiogroup">
          <button type="button" className={kind === 'company' ? 'on' : ''} onClick={() => setKind('company')}>Entreprise</button>
          <button type="button" className={kind === 'topic' ? 'on' : ''} onClick={() => setKind('topic')}>Thème</button>
        </div>
        <label>Nom<input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'company' ? 'ex. Wix' : 'ex. Véhicules autonomes'} required minLength={2} maxLength={60} autoFocus /></label>
        <label>Description (optionnel)<input value={description} onChange={e => setDescription(e.target.value)} maxLength={300} /></label>

        <fieldset>
          <legend>Actualités</legend>
          <label className="check"><input type="checkbox" checked={gdelt} onChange={e => setGdelt(e.target.checked)} /> Presse mondiale via GDELT (gratuit, sans clé)</label>
          {gdelt && <label>Requête GDELT<input value={query} onChange={e => setQuery(e.target.value)} placeholder={name ? `"${name}"` : '"Nom exact"'} /></label>}
          <label>Flux RSS officiels (optionnel, un par ligne)<textarea rows={2} value={rss} onChange={e => setRss(e.target.value)} placeholder="https://ir.exemple.com/rss/news-releases.xml" /></label>
        </fieldset>

        {kind === 'company' && (
          <fieldset>
            <legend>Offres d’emploi</legend>
            <label>Plateforme du site carrières
              <select value={jobsType} onChange={e => setJobsType(e.target.value)}>
                <option value="">Aucune pour l’instant</option>
                <option value="lever">Lever (jobs.lever.co/…)</option>
                <option value="greenhouse">Greenhouse (boards.greenhouse.io/…)</option>
                <option value="smartrecruiters">SmartRecruiters (jobs.smartrecruiters.com/…)</option>
              </select>
            </label>
            {jobsType && <label>Identifiant dans l’URL<input value={jobsId} onChange={e => setJobsId(e.target.value.trim())} placeholder="ex. wix" required /></label>}
            {jobsType === 'lever' && <label className="check"><input type="checkbox" checked={leverEu} onChange={e => setLeverEu(e.target.checked)} /> Hébergé sur jobs.eu.lever.co</label>}
            <p className="hint">Astuce : ouvrez « Postuler » sur le site carrières de l’entreprise et regardez le domaine de la page.</p>
          </fieldset>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy || name.trim().length < 2}>{busy ? 'Création…' : 'Créer la veille'}</button>
        </div>
      </form>
    </Modal>
  );
}
