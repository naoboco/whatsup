# Vigie — veille professionnelle en messagerie

Chaque entreprise ou thème suivi a sa conversation. Les actualités et les offres d'emploi y arrivent comme des messages, avec leur source d'origine, un résumé, une date et un lien direct. Une conversation « Rappels » accepte des demandes en français courant (« Rappelle-moi de postuler chez Mobileye demain à 18 h »), les fait confirmer, puis les déclenche à l'heure dite.

## Architecture

```
vigie/
├─ server/                 Node.js 22 + TypeScript (Express 5, pg, zod, luxon, web-push)
│  ├─ src/connectors/      rss.ts · gdelt.ts · jobs.ts (Lever, Greenhouse, SmartRecruiters)
│  ├─ src/services/        ingest (déduplication/mises à jour) · collector · scheduler
│  │                       reminders · frenchParser (secours local) · openaiInterpreter
│  │                       push (Web Push + préférences) · events (SSE) · url (validation)
│  ├─ src/db/              migrations SQL versionnées · bootstrap · démo
│  ├─ src/routes/api.ts    API REST + flux temps réel /api/events
│  └─ test/                31 tests (unitaires + intégration sur un vrai PostgreSQL)
├─ client/                 React 19 + TypeScript (Vite), PWA + service worker (public/sw.js)
└─ docker-compose.yml      PostgreSQL 16
```

**Flux de données**

1. Le **planificateur** (dans le serveur, verrous consultatifs PostgreSQL pour éviter tout doublon entre instances) vérifie chaque minute les sources dont l'intervalle est écoulé, et toutes les 15 s les rappels échus.
2. Chaque **connecteur** récupère et normalise les éléments. Chaque URL est validée : http(s) uniquement, pas d'hôte privé, pas d'identifiants, paramètres de pistage retirés.
3. **L'ingestion** déduplique par URL canonique (actualités) ou par identifiant d'offre (emplois). Un même titre repris par un autre média est rattaché au message existant (« Également rapporté par… »). Un contenu modifié à la source est mis à jour et marqué « mis à jour ». Une offre disparue de la source est marquée « Retirée », jamais supprimée.
4. La première collecte d'une source se fait en **import silencieux** (messages lus, un message système récapitulatif). Ensuite, chaque nouveauté est non lue et notifiée, avec un regroupement au-delà d'un seuil réglable.
5. Les **notifications** passent par un point unique qui applique les préférences (types, silencieux par conversation, heures calmes), puis les diffuse en SSE (bandeau dans l'application) et en Web Push (service worker).

**Rappels.** Le message de l'utilisateur est interprété par OpenAI (Chat Completions, sortie JSON stricte) si une clé est configurée, sinon par l'analyseur français local. Le résultat est toujours une **carte à confirmer** : rien n'est programmé sans clic. Le modèle ne planifie rien lui-même : il renvoie une intention (`create` / `update` / `delete` / `list` / `clarify`), une date locale et une répétition. Le serveur valide ensuite ces données : la date ne peut pas être passée, l'identifiant ciblé doit être celui d'un rappel existant, et le JSON doit respecter le schéma. En cas d'échec d'OpenAI, l'analyseur local prend le relais et la raison reste affichée sur la carte.

## Écrans

| Écran | Contenu |
|---|---|
| Liste des conversations | Recherche insensible aux accents (noms, titres, lieux, avec extraits surlignés), filtres Toutes · Non lus · Actualités · Emplois, dernier message, heure, badge de non-lus, icônes silencieux, épinglé, source en erreur |
| Conversation d'une veille | Cartes « Actualité » (bleu) et « Offre d'emploi » (vert) distinctes ; filtres Toutes · Actualités · Emplois · Non lus ; séparateurs de jour, séparateur « N messages non lus », historique paginé, bouton « nouveaux messages » |
| Carte actualité | Titre, résumé, source (éditeur + domaine), date de publication, « Lire l'article », médias ayant repris l'information |
| Carte emploi | Poste, lieu, équipe, contrat, date, source, « Postuler » (lien de candidature) et « Voir l'offre » |
| Fiche de la veille | État de chaque source (OK, erreur avec message exact, en attente), collecte manuelle, activation et désactivation, ajout de source, silencieux, épingler, suppression |
| Rappels | Saisie libre, cartes de confirmation (Confirmer / Modifier / Annuler), rappels déclenchés (Fait, +10 min, +1 h, Modifier, Supprimer, lien vers la veille concernée), panneau des rappels programmés |
| Nouvelle veille | Entreprise ou thème ; GDELT, flux RSS, plateforme de recrutement |
| Préférences | Push sur l'appareil, test, types notifiés, regroupement, heures calmes, fuseau (Asia/Jerusalem par défaut), état du service, purge des données de démo |

Interface responsive : deux panneaux sur ordinateur, navigation à écran unique sur téléphone (le bouton retour fonctionne), thèmes clair et sombre, squelettes de chargement et états vides.

## Lancer le projet

Prérequis : Node.js ≥ 20, et PostgreSQL 16 (via Docker ou installé localement).

```bash
cd vigie
npm run install:all            # dépendances serveur + client
npm run db:up                  # PostgreSQL via Docker (ou votre propre instance)
cp server/.env.example server/.env   # puis ajustez DATABASE_URL, OPENAI_API_KEY…

# Développement (deux terminaux)
npm run dev:server             # API sur http://localhost:4000 (migrations appliquées au démarrage)
npm run dev:client             # interface sur http://localhost:5173 (proxy /api → 4000)

# Production locale : un seul processus sert l'API et l'interface compilée
npm run build && npm start     # http://localhost:4000

# Vérifications
npm test                       # nécessite une base « vigie_test » (ou TEST_DATABASE_URL) — elle est réinitialisée
npm run typecheck
```

Sans Docker : `createdb vigie` et `createdb vigie_test` avec un utilisateur `vigie`/`vigie`, ou adaptez `DATABASE_URL`.

## Sources branchées par défaut (Mobileye)

| Source | Type | Accès |
|---|---|---|
| `https://ir.mobileye.com/rss/news-releases.xml` | Communiqués officiels (flux RSS publié par Mobileye) | Public, sans clé |
| `https://api.eu.lever.co/v0/postings/mobileye` | Offres du site carrières (careers.mobileye.com s'appuie sur Lever) | API publique documentée, sans clé |
| GDELT DOC 2.0, requête `"Mobileye"` | Presse mondiale (anglais, français, hébreu) | Données ouvertes, sans clé ; titre seul, sans résumé (affiché comme tel) |

Chaque message affiche son éditeur réel et son domaine. Aucune source ne scrape de site dont les conditions l'interdisent (LinkedIn, par exemple, n'est pas utilisé).

**Ajouter une veille** : bouton « + ». Pour les emplois, repérez le domaine de la page « Postuler » de l'entreprise : `jobs.lever.co/<id>`, `boards.greenhouse.io/<id>` ou `jobs.smartrecruiters.com/<id>`. Pour les actualités, cherchez un flux RSS « Investor relations » ou « Newsroom », sinon utilisez GDELT. À l'ajout d'une source Lever ou SmartRecruiters, un filtre pays (`IL`) permet de ne garder que les postes en Israël.

## Ce qui fonctionne réellement, et ce qui manque

### Vérifié dans l'environnement de construction

- Schéma, migrations, API, validation des entrées (zod), flux temps réel SSE, sur un vrai PostgreSQL 16.
- Déduplication, mise à jour, offres retirées, fusion inter-sources, import initial silencieux, remplacement automatique de la démo par le réel : tests d'intégration.
- Rappels avec l'analyseur local : création, confirmation obligatoire, déclenchement par le planificateur (message dans « Rappels » et notification), répétitions (quotidienne, jours ouvrés dim.–jeu., hebdomadaire, mensuelle, avec rattrapage des occurrences manquées), report, modification, suppression, demandes incomplètes (question posée). Un rappel réel a été programmé, déclenché et affiché dans l'interface.
- Intégration OpenAI : testée contre un **serveur simulé** compatible Chat Completions (création, modification, rejet d'un identifiant inventé, repli local sur erreur 401).
- Connecteurs RSS/Atom, Lever, Greenhouse, SmartRecruiters et GDELT : testés sur des **jeux de données de test** reproduisant la structure réelle des réponses. La structure des réponses de Lever et du flux RSS Mobileye a été vérifiée sur les réponses en ligne.
- Validation des liens (`javascript:`, hôtes privés, identifiants dans l'URL, pistage).
- Interface sur ordinateur (1360 px) et téléphone (390 px), en thème clair et sombre, via Playwright, sans erreur JavaScript.

### Non vérifié ici (le bac à sable de construction n'a pas accès à Internet)

- Les appels réels à `ir.mobileye.com`, `api.eu.lever.co` et `api.gdeltproject.org` ont renvoyé 403 depuis le bac à sable. C'est pourquoi les captures montrent des données de démonstration. Sur votre machine, la première collecte les remplacera automatiquement.
- Livraison d'une notification Web Push par un vrai service de push de navigateur. Le code (clés VAPID, abonnement, service worker, nettoyage des abonnements expirés) est en place ; testez avec Préférences → « Activer les notifications » → « Envoyer un test ».
- Un appel au vrai modèle OpenAI.

### Ce qui nécessite une clé ou une action de votre part

| Élément | Sans action | Avec action |
|---|---|---|
| Interprétation des rappels | Analyseur local (création et liste ; modification et suppression via les boutons) | `OPENAI_API_KEY` : phrases libres, modification et suppression en langage naturel. Choisissez un `OPENAI_MODEL` disponible sur votre compte et compatible avec `response_format: json_schema`. |
| Actualités et emplois Mobileye | Fonctionnent sans clé si le serveur a accès à Internet | — |
| Notifications push | Bandeaux dans l'application quand elle est ouverte | Autoriser les notifications dans le navigateur. En production, HTTPS est obligatoire (localhost est toléré). Sur iPhone, installez d'abord l'application sur l'écran d'accueil. |
| Mise en ligne | Application mono-utilisateur, sans compte | Définir `APP_TOKEN` (l'API exige alors un jeton ; enregistrez-le dans le navigateur via `localStorage.vigie_token`) et placer le serveur derrière HTTPS. Pour plusieurs utilisateurs, il faudra ajouter de vrais comptes. |

### Limites connues

- GDELT ne fournit pas de résumé : la carte l'indique au lieu d'en inventer un.
- L'API Lever renvoie toutes les offres de Mobileye dans le monde (près de 200) : elles sont importées en silence la première fois. Pour ne garder qu'Israël, retirez la source dans la fiche et ajoutez-la de nouveau avec le pays `IL` (il n'existe pas encore d'écran pour modifier la configuration d'une source existante).
- La « semaine ouvrée » suit le calendrier israélien (dimanche–jeudi) en fuseau Asia/Jerusalem, et lundi–vendredi ailleurs.
- La répétition mensuelle d'un rappel fixé au 31 se cale sur le dernier jour des mois plus courts.
