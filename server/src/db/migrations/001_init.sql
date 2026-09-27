CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('company','topic','reminders')),
  description   text,
  accent        text NOT NULL DEFAULT '#E8A33D',
  muted         boolean NOT NULL DEFAULT false,
  pinned        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('rss','gdelt','lever','greenhouse','smartrecruiters','demo')),
  category         text NOT NULL CHECK (category IN ('news','jobs')),
  label            text NOT NULL,
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled          boolean NOT NULL DEFAULT true,
  is_demo          boolean NOT NULL DEFAULT false,
  interval_minutes integer NOT NULL DEFAULT 30 CHECK (interval_minutes >= 5),
  last_fetched_at  timestamptz,
  last_success_at  timestamptz,
  last_error       text,
  last_item_count  integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sources_conv_idx ON sources(conversation_id);

CREATE TABLE reminders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text               text NOT NULL,
  due_at             timestamptz NOT NULL,
  timezone           text NOT NULL DEFAULT 'Asia/Jerusalem',
  recurrence         text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekdays','weekly','monthly')),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','fired','done','cancelled')),
  original_request   text,
  interpreter        text NOT NULL DEFAULT 'local' CHECK (interpreter IN ('openai','local','manual')),
  related_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  fire_count         integer NOT NULL DEFAULT 0,
  last_fired_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_due_idx ON reminders(due_at) WHERE status = 'scheduled';

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_id        uuid REFERENCES sources(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind IN ('news','job','reminder','user','assistant','system')),
  dedup_key        text,
  title_key        text,
  title            text,
  body             text,
  url              text,
  apply_url        text,
  source_name      text,
  source_domain    text,
  published_at     timestamptz,
  job_location     text,
  job_department   text,
  job_commitment   text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash     text,
  is_demo          boolean NOT NULL DEFAULT false,
  reminder_id      uuid REFERENCES reminders(id) ON DELETE SET NULL,
  closed_at        timestamptz,
  revised_at       timestamptz,
  read_at          timestamptz,
  sort_at          timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX messages_dedup_idx ON messages(conversation_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX messages_title_key_idx ON messages(conversation_id, title_key);
CREATE INDEX messages_conv_sort_idx ON messages(conversation_id, sort_at DESC, id);
CREATE INDEX messages_unread_idx ON messages(conversation_id) WHERE read_at IS NULL;

CREATE TABLE settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint    text PRIMARY KEY,
  keys        jsonb NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
