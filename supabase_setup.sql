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


-- Cash Reports table
create table if not exists cash_reports (
  id                  bigserial primary key,
  chat_id             text        not null,
  message_id          bigint      not null,
  date_key            date        not null,
  cashier             text,
  shift               text,
  cash_in_khr         numeric,
  cash_in_usd         numeric,
  bank_aba_khr        numeric,
  bank_aba_usd        numeric,
  bank_acleda_khr     numeric,
  bank_acleda_usd     numeric,
  bank_lolc_khr       numeric,
  bank_lolc_usd       numeric,
  bank_sathapana_khr  numeric,
  bank_sathapana_usd  numeric,
  bank_prince_khr     numeric,
  bank_prince_usd     numeric,
  bank_other_khr      numeric,
  bank_other_usd      numeric,
  total_bank_khr      numeric,
  total_bank_usd      numeric,
  total_income_khr    numeric,
  total_income_usd    numeric,
  expenses_khr        numeric,
  expenses_usd        numeric,
  profit_khr          numeric,
  profit_usd          numeric,
  sales_22oz          numeric,
  sales_16oz          numeric,
  sales_12oz          numeric,
  total_net_sales_khr numeric,
  total_net_sales_usd numeric,
  cash_out_khr        numeric,
  cash_out_usd        numeric,
  grand_total_khr     numeric,
  grand_total_usd     numeric,
  notes               text,
  raw_json            text,
  created_at          timestamptz not null default now()
);

create unique index if not exists cash_reports_unique
  on cash_reports (chat_id, message_id);

create index if not exists cash_reports_date
  on cash_reports (chat_id, date_key);
