import { useState } from 'react';

export type SourceDraft = { type: string; label?: string; config: Record<string, unknown> };

const HELP: Record<string, string> = {
  gdelt: 'Index ouvert de la presse mondiale (GDELT). Fournit titre, lien, média et date — pas de résumé.',
  rss: 'Flux RSS ou Atom officiel (salle de presse, relations investisseurs, blog). Recommandé : c’est la source primaire.',
  lever: 'Site carrières hébergé par Lever. L’identifiant est dans l’URL : jobs.lever.co/<identifiant> (ou jobs.eu.lever.co).',
  greenhouse: 'Site carrières Greenhouse. L’identifiant est dans l’URL : boards.greenhouse.io/<identifiant>.',
  smartrecruiters: 'Site carrières SmartRecruiters. L’identifiant est dans l’URL : jobs.smartrecruiters.com/<identifiant>.',
};

export default function SourceForm({ defaultQuery = '', onSubmit, submitLabel, busy }: { defaultQuery?: string; onSubmit: (s: SourceDraft) => void; submitLabel: string; busy?: boolean }) {
  const [type, setType] = useState('rss');
  const [url, setUrl] = useState('');
  const [publisher, setPublisher] = useState('');
  const [query, setQuery] = useState(defaultQuery ? `"${defaultQuery}"` : '');
  const [ident, setIdent] = useState('');
  const [region, setRegion] = useState('global');
  const [country, setCountry] = useState('');
  const [itemKind, setItemKind] = useState('news');

  const build = (): SourceDraft => {
    if (type === 'rss') return { type, config: { url, publisher: publisher || undefined, itemKind } };
    if (type === 'gdelt') return { type, config: { query } };
    if (type === 'lever') return { type, config: { site: ident, region, publisher: publisher || undefined, country: country || undefined } };
    if (type === 'greenhouse') return { type, config: { board: ident, publisher: publisher || undefined } };
    return { type, config: { company: ident, publisher: publisher || undefined, country: country || undefined } };
  };

  return (
    <div className="source-form">
      <label>Type de source
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="rss">Actualités — flux RSS/Atom officiel</option>
          <option value="gdelt">Actualités — presse mondiale (GDELT)</option>
          <option value="lever">Emplois — Lever</option>
          <option value="greenhouse">Emplois — Greenhouse</option>
          <option value="smartrecruiters">Emplois — SmartRecruiters</option>
        </select>
      </label>
      <p className="hint">{HELP[type]}</p>
      {type === 'rss' && <>
        <label>URL du flux<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://exemple.com/rss.xml" required /></label>
        <label>Contenu du flux
          <select value={itemKind} onChange={e => setItemKind(e.target.value)}><option value="news">Actualités</option><option value="job">Offres d’emploi</option></select>
        </label>
      </>}
      {type === 'gdelt' && <label>Requête<input value={query} onChange={e => setQuery(e.target.value)} placeholder='"Mobileye" OR "EyeQ"' required /></label>}
      {['lever', 'greenhouse', 'smartrecruiters'].includes(type) && <label>Identifiant du site carrières<input value={ident} onChange={e => setIdent(e.target.value.trim())} placeholder="ex. mobileye" required /></label>}
      {type === 'lever' && <label>Région Lever<select value={region} onChange={e => setRegion(e.target.value)}><option value="global">jobs.lever.co</option><option value="eu">jobs.eu.lever.co</option></select></label>}
      {(type === 'lever' || type === 'smartrecruiters') && <label>Pays (optionnel, code ISO)<input value={country} onChange={e => setCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="IL" /></label>}
      {type !== 'gdelt' && <label>Nom de l’éditeur affiché (optionnel)<input value={publisher} onChange={e => setPublisher(e.target.value)} placeholder="ex. Mobileye (communiqué officiel)" /></label>}
      <button type="button" className="btn primary" disabled={busy} onClick={() => onSubmit(build())}>{submitLabel}</button>
    </div>
  );
}
