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
