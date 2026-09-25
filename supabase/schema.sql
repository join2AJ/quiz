-- PassSection Quiz Platform — Supabase schema
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
--
-- Row Level Security is ON for every table with NO policies, so the public
-- "anon" key can read nothing. Only the server (Netlify Function) uses the
-- secret service_role key, which bypasses RLS. Never put the service_role key
-- in the frontend.

create table if not exists psq_users (
  username      text primary key,
  name          text not null default '',
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists psq_exams (
  id                text primary key,
  title             text not null,
  team              text not null default '',
  site              text not null default '',
  exam_date         text not null default '',
  instructions      text not null default '',
  instructions_hi   text not null default '',
  unlock_days       integer not null default 10,
  estimated_minutes integer,
  status            text not null default 'Active',
  file_name         text not null default '',
  thresholds        jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create table if not exists psq_assignments (
  exam_id     text not null references psq_exams(id) on delete cascade,
  username    text not null references psq_users(username) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (exam_id, username)
);

create table if not exists psq_settings (
  key   text primary key,
  value text not null
);

create table if not exists psq_sections (
  exam_id        text not null references psq_exams(id) on delete cascade,
  no             integer not null,
  name           text not null,
  name_hi        text not null default '',
  description    text not null default '',
  description_hi text not null default '',
  primary key (exam_id, no)
);

create table if not exists psq_questions (
  exam_id    text not null references psq_exams(id) on delete cascade,
  no         integer not null,
  qid        text not null,
  section_no integer not null,
  type       text not null default '',
  category   text not null default '',
  text_en    text not null,
  text_hi    text not null default '',
  options    jsonb not null,
  primary key (exam_id, no)
);

-- Kept apart from psq_questions so the answer key is never selected by accident.
create table if not exists psq_answer_key (
  exam_id     text not null references psq_exams(id) on delete cascade,
  no          integer not null,
  correct     text not null,
  category    text not null default '',
  explanation text not null default '',
  primary key (exam_id, no)
);

create table if not exists psq_attempts (
  exam_id      text not null references psq_exams(id) on delete cascade,
  username     text not null,
  status       text not null,
  started_at   timestamptz not null,
  submitted_at timestamptz,
  state        jsonb not null default '{}'::jsonb,
  result       jsonb,
  primary key (exam_id, username)
);

-- One row per submission = one row of the "Participants Summary" sheet.
create table if not exists psq_summary (
  exam_id      text not null references psq_exams(id) on delete cascade,
  username     text not null,
  row          jsonb not null,
  submitted_at timestamptz not null default now(),
  primary key (exam_id, username)
);

-- One row per participant per question = the "Question-wise Responses" sheet.
create table if not exists psq_responses (
  exam_id     text not null references psq_exams(id) on delete cascade,
  username    text not null,
  question_no integer not null,
  row         jsonb not null,
  primary key (exam_id, username, question_no)
);

alter table psq_users       enable row level security;
alter table psq_exams       enable row level security;
alter table psq_assignments enable row level security;
alter table psq_settings    enable row level security;
alter table psq_sections    enable row level security;
alter table psq_questions   enable row level security;
alter table psq_answer_key  enable row level security;
alter table psq_attempts    enable row level security;
alter table psq_summary     enable row level security;
alter table psq_responses   enable row level security;

-- ---------------------------------------------------------------------------
-- v2: staff profile, per-exam config, richer questions, scoring metadata and
-- the tamper-evident audit log. Safe to run on an existing v1 database.
-- ---------------------------------------------------------------------------
alter table psq_users      add column if not exists name_hi     text not null default '';
alter table psq_users      add column if not exists designation text not null default '';
alter table psq_users      add column if not exists post        text not null default '';
alter table psq_users      add column if not exists shift       text not null default '';
alter table psq_users      add column if not exists staff_id    text not null default '';
alter table psq_exams      add column if not exists config      jsonb not null default '{}'::jsonb;
alter table psq_questions  add column if not exists difficulty  text not null default '';
alter table psq_questions  add column if not exists scenario_en text not null default '';
alter table psq_questions  add column if not exists scenario_hi text not null default '';
-- Scoring model: full/partial credit options, concern options, dimension,
-- weight, reveal map (admin-only interpretation of each option), etc.
alter table psq_answer_key add column if not exists meta        jsonb not null default '{}'::jsonb;

-- Audit trail: every login, exam action and admin action. Each row stores the
-- SHA-256 of the previous row (prev_hash) and of itself (hash), computed by
-- the trigger below under a lock, so the chain has no gaps or forks even when
-- several requests log at once. hash = sha256(prev_hash \n seq \n ts \n event
-- \n username \n exam_id \n data). The app verifies the chain on demand.
create table if not exists psq_audit_log (
  seq       bigint primary key,
  ts        text not null,
  event     text not null,
  username  text not null default '',
  exam_id   text not null default '',
  data      text not null default '{}',
  prev_hash text not null,
  hash      text not null
);
create index if not exists psq_audit_log_exam on psq_audit_log (exam_id, seq);
create index if not exists psq_audit_log_user on psq_audit_log (username, seq);
alter table psq_audit_log enable row level security;

create or replace function psq_audit_chain() returns trigger
language plpgsql as $$
declare
  last_seq  bigint;
  last_hash text;
begin
  perform pg_advisory_xact_lock(4242001);
  select seq, hash into last_seq, last_hash from psq_audit_log order by seq desc limit 1;
  new.seq       := coalesce(last_seq, 0) + 1;
  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.hash := encode(sha256(convert_to(
    new.prev_hash || E'\n' || new.seq::text || E'\n' || new.ts || E'\n' || new.event || E'\n' ||
    new.username || E'\n' || new.exam_id || E'\n' || new.data, 'UTF8')), 'hex');
  return new;
end $$;

-- Entries can be added, never changed or removed.
create or replace function psq_audit_readonly() returns trigger
language plpgsql as $$
begin
  raise exception 'psq_audit_log is append-only';
end $$;

drop trigger if exists psq_audit_chain on psq_audit_log;
create trigger psq_audit_chain before insert on psq_audit_log
  for each row execute function psq_audit_chain();
drop trigger if exists psq_audit_readonly on psq_audit_log;
create trigger psq_audit_readonly before update or delete on psq_audit_log
  for each row execute function psq_audit_readonly();

revoke all on function psq_audit_chain() from public;
revoke all on function psq_audit_readonly() from public;
