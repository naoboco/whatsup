import type { Connector } from './types.js';
import { rssConnector } from './rss.js';
import { gdeltConnector } from './gdelt.js';
import { leverConnector, greenhouseConnector, smartRecruitersConnector } from './jobs.js';

export const connectors: Record<string, Connector<any>> = {
  rss: rssConnector,
  gdelt: gdeltConnector,
  lever: leverConnector,
  greenhouse: greenhouseConnector,
  smartrecruiters: smartRecruitersConnector,
};

export type { NormalizedItem } from './types.js';
