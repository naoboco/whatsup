import { ExternalLink, MapPin, Briefcase, Newspaper, Building2, RefreshCw, Info } from 'lucide-react';
import type { Message } from '../lib/types';
import { time, shortDate, fullDate } from '../lib/format';

function Provenance({ m }: { m: Message }) {
  if (m.is_demo) return <span className="prov demo">Données de démonstration — aucune publication réelle</span>;
  return (
    <span className="prov" title={m.source_label ?? undefined}>
      <span className="prov-name">{m.source_name}</span>
      {m.source_domain && m.source_domain !== m.source_name && <span className="prov-domain">{m.source_domain}</span>}
      {m.payload?.via && <span className="prov-via">via {m.payload.via}</span>}
    </span>
  );
}

function Meta({ m }: { m: Message }) {
  return (
    <div className="card-meta">
      {m.published_at && <span title={fullDate(m.published_at)}>Publié le {shortDate(m.published_at)}</span>}
      {m.revised_at && <span className="tag upd" title={`Contenu mis à jour à la source le ${fullDate(m.revised_at)}`}><RefreshCw size={11} /> mis à jour</span>}
      <span className="stamp">{time(m.sort_at)}</span>
    </div>
  );
}

export function NewsCard({ m, unread }: { m: Message; unread: boolean }) {
  const also: { name: string; url: string }[] = m.payload?.alsoReportedBy ?? [];
  return (
    <article className={`bubble card news ${unread ? 'unread' : ''} ${m.is_demo ? 'is-demo' : ''}`}>
      <div className="card-kind"><Newspaper size={13} /> Actualité {m.is_demo && <span className="tag demo">Démo</span>}{m.payload?.language && m.payload.language !== 'français' && <span className="tag">{m.payload.language}</span>}</div>
      <h3>{m.title}</h3>
      {m.body ? <p className="summary">{m.body}</p> : <p className="summary muted"><Info size={12} /> Résumé non fourni par la source ({m.payload?.noSummaryReason ?? 'titre seul'}).</p>}
      <Provenance m={m} />
      {also.length > 0 && (
        <p className="also">Également rapporté par : {also.map((a, i) => <span key={a.url}>{i > 0 && ', '}<a href={a.url} target="_blank" rel="noopener noreferrer nofollow">{a.name}</a></span>)}</p>
      )}
      <div className="card-actions">
        {m.url && !m.is_demo
          ? <a className="btn action" href={m.url} target="_blank" rel="noopener noreferrer nofollow">Lire l’article <ExternalLink size={14} /></a>
          : <button className="btn action" disabled title="Élément fictif : aucun article réel">Lire l’article (démo)</button>}
      </div>
      <Meta m={m} />
    </article>
  );
}

export function JobCard({ m, unread }: { m: Message; unread: boolean }) {
  const closed = !!m.closed_at;
  return (
    <article className={`bubble card job ${unread ? 'unread' : ''} ${closed ? 'closed' : ''} ${m.is_demo ? 'is-demo' : ''}`}>
      <div className="card-kind job"><Briefcase size={13} /> Offre d’emploi {m.is_demo && <span className="tag demo">Démo</span>}{closed && <span className="tag closed">Retirée</span>}</div>
      <h3>{m.title}</h3>
      <dl className="job-facts">
        {m.job_location && <div><dt><MapPin size={13} /><span className="sr">Lieu</span></dt><dd>{m.job_location}</dd></div>}
        {m.job_department && <div><dt><Building2 size={13} /><span className="sr">Équipe</span></dt><dd>{m.job_department}</dd></div>}
        {m.job_commitment && <div><dt><Briefcase size={13} /><span className="sr">Contrat</span></dt><dd>{m.job_commitment}</dd></div>}
      </dl>
      {m.body && <p className="summary">{m.body}</p>}
      <Provenance m={m} />
      <div className="card-actions">
        {m.is_demo ? <button className="btn action" disabled>Postuler (démo)</button>
          : closed ? <button className="btn action" disabled title={`Offre retirée de la source le ${m.closed_at ? shortDate(m.closed_at) : ''}`}>Offre retirée</button>
          : <>
              <a className="btn action primary" href={m.apply_url ?? m.url ?? '#'} target="_blank" rel="noopener noreferrer nofollow">Postuler <ExternalLink size={14} /></a>
              {m.url && m.apply_url && m.url !== m.apply_url && <a className="btn action ghost" href={m.url} target="_blank" rel="noopener noreferrer nofollow">Voir l’offre</a>}
            </>}
      </div>
      <Meta m={m} />
    </article>
  );
}

export function SystemNote({ m }: { m: Message }) {
  return <div className="system-note">{m.body}</div>;
}
