export interface NormalizedItem {
  kind: 'news' | 'job';
  /** Identifiant stable fourni par la source (guid, id d'offre) si disponible. */
  externalId?: string;
  url: string;
  applyUrl?: string;
  title: string;
  summary: string;
  publishedAt: Date | null;
  /** Nom lisible de l'éditeur réel (ex. « Reuters », « Mobileye Careers »). */
  sourceName: string;
  location?: string;
  department?: string;
  commitment?: string;
  extra?: Record<string, unknown>;
}

export interface Connector<C> {
  type: string;
  category: 'news' | 'jobs';
  /** Description de la provenance affichée dans l'interface. */
  describe(config: C): string;
  parseConfig(raw: unknown): C;
  fetch(config: C): Promise<NormalizedItem[]>;
}
