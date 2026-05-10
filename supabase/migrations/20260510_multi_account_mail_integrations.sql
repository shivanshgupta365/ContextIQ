-- Enable up to 5 Gmail + Outlook accounts per workspace user.

alter table if exists public.gmail_integrations
  add column if not exists integration_slot smallint,
  add column if not exists is_primary boolean;

update public.gmail_integrations
set integration_slot = 1
where integration_slot is null;

update public.gmail_integrations
set is_primary = true
where is_primary is null;

alter table public.gmail_integrations
  alter column integration_slot set default 1,
  alter column integration_slot set not null,
  alter column is_primary set default true,
  alter column is_primary set not null;

alter table public.gmail_integrations
  drop constraint if exists gmail_integrations_workspace_id_user_id_provider_key;

with ranked as (
  select
    id,
    row_number() over (
      partition by workspace_id, user_id, provider
      order by is_primary desc, updated_at desc, created_at desc
    ) as rn
  from public.gmail_integrations
)
update public.gmail_integrations gi
set is_primary = (ranked.rn = 1)
from ranked
where gi.id = ranked.id;

create unique index if not exists idx_gmail_integrations_slot_unique
  on public.gmail_integrations(workspace_id, user_id, provider, integration_slot);

create unique index if not exists idx_gmail_integrations_primary_unique
  on public.gmail_integrations(workspace_id, user_id, provider)
  where is_primary = true;

create unique index if not exists idx_gmail_integrations_email_unique
  on public.gmail_integrations(workspace_id, user_id, provider, lower(email))
  where email is not null;

alter table public.gmail_integrations
  drop constraint if exists gmail_integrations_integration_slot_check;

alter table public.gmail_integrations
  add constraint gmail_integrations_integration_slot_check
  check (integration_slot >= 1 and integration_slot <= 5);


alter table if exists public.outlook_integrations
  add column if not exists integration_slot smallint,
  add column if not exists is_primary boolean;

update public.outlook_integrations
set integration_slot = 1
where integration_slot is null;

update public.outlook_integrations
set is_primary = true
where is_primary is null;

alter table public.outlook_integrations
  alter column integration_slot set default 1,
  alter column integration_slot set not null,
  alter column is_primary set default true,
  alter column is_primary set not null;

alter table public.outlook_integrations
  drop constraint if exists outlook_integrations_workspace_id_user_id_provider_key;

with ranked as (
  select
    id,
    row_number() over (
      partition by workspace_id, user_id, provider
      order by is_primary desc, updated_at desc, created_at desc
    ) as rn
  from public.outlook_integrations
)
update public.outlook_integrations oi
set is_primary = (ranked.rn = 1)
from ranked
where oi.id = ranked.id;

create unique index if not exists idx_outlook_integrations_slot_unique
  on public.outlook_integrations(workspace_id, user_id, provider, integration_slot);

create unique index if not exists idx_outlook_integrations_primary_unique
  on public.outlook_integrations(workspace_id, user_id, provider)
  where is_primary = true;

create unique index if not exists idx_outlook_integrations_email_unique
  on public.outlook_integrations(workspace_id, user_id, provider, lower(email))
  where email is not null;

alter table public.outlook_integrations
  drop constraint if exists outlook_integrations_integration_slot_check;

alter table public.outlook_integrations
  add constraint outlook_integrations_integration_slot_check
  check (integration_slot >= 1 and integration_slot <= 5);
