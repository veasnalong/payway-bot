-- Run this in Supabase → SQL Editor

create table if not exists aba_transactions (
  id           bigserial primary key,
  chat_id      text        not null,
  message_id   bigint      not null,
  date_key     date        not null,
  amount       numeric     not null,
  currency     text        not null default 'KHR',
  payer        text,
  card_mask    text,
  merchant     text,
  pay_method   text,
  trx_id       text,
  apv          text,
  date_time_str text,
  timestamp    timestamptz,
  time_str     text,
  created_at   timestamptz not null default now()
);

-- Prevent duplicate messages
create unique index if not exists aba_transactions_unique
  on aba_transactions (chat_id, message_id);

-- Speed up date queries
create index if not exists aba_transactions_date
  on aba_transactions (chat_id, date_key);
