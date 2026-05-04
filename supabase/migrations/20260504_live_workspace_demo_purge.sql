alter table public.workspaces
  add column if not exists seed_source text,
  add column if not exists seeded_at timestamptz;

with target_workspaces as (
  select a.workspace_id
  from public.accounts a
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
  group by a.workspace_id
  having count(distinct lower(coalesce(a.domain, ''))) = 3
),
demo_accounts as (
  select a.id, a.workspace_id
  from public.accounts a
  join target_workspaces tw on tw.workspace_id = a.workspace_id
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
),
demo_contacts as (
  select c.id
  from public.contacts c
  join demo_accounts da on da.id = c.account_id
)
delete from public.search_index_entries sie
where sie.workspace_id in (select workspace_id from target_workspaces)
  and (
    sie.entity_id in (
      select id from demo_accounts
      union all
      select id from demo_contacts
    )
    or lower(coalesce(sie.title, '')) in (
      'security blocker',
      'renewal blocker',
      'communication preference'
    )
    or lower(coalesce(sie.body, '')) like '%david explicitly stated they cannot proceed without soc2 type ii compliance verified by q3%'
  );

with target_workspaces as (
  select a.workspace_id
  from public.accounts a
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
  group by a.workspace_id
  having count(distinct lower(coalesce(a.domain, ''))) = 3
),
demo_accounts as (
  select a.id
  from public.accounts a
  join target_workspaces tw on tw.workspace_id = a.workspace_id
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
)
delete from public.slack_message_syncs sms
where sms.account_id in (select id from demo_accounts);

with target_workspaces as (
  select a.workspace_id
  from public.accounts a
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
  group by a.workspace_id
  having count(distinct lower(coalesce(a.domain, ''))) = 3
),
demo_accounts as (
  select a.id
  from public.accounts a
  join target_workspaces tw on tw.workspace_id = a.workspace_id
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
)
delete from public.outlook_message_syncs oms
where oms.account_id in (select id from demo_accounts);

with target_workspaces as (
  select a.workspace_id
  from public.accounts a
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
  group by a.workspace_id
  having count(distinct lower(coalesce(a.domain, ''))) = 3
),
demo_accounts as (
  select a.id
  from public.accounts a
  join target_workspaces tw on tw.workspace_id = a.workspace_id
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
)
delete from public.linkedin_profile_syncs lps
where lps.account_id in (select id from demo_accounts);

with target_workspaces as (
  select a.workspace_id
  from public.accounts a
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
  group by a.workspace_id
  having count(distinct lower(coalesce(a.domain, ''))) = 3
),
demo_accounts as (
  select a.id, a.workspace_id
  from public.accounts a
  join target_workspaces tw on tw.workspace_id = a.workspace_id
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
)
delete from public.generated_outputs go
where go.account_id in (select id from demo_accounts)
   or (
     go.workspace_id in (select workspace_id from target_workspaces)
     and coalesce(go.model_name, '') = 'seeded-demo'
   );

with target_workspaces as (
  select a.workspace_id
  from public.accounts a
  where (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  )
  group by a.workspace_id
  having count(distinct lower(coalesce(a.domain, ''))) = 3
)
delete from public.accounts a
where a.workspace_id in (select workspace_id from target_workspaces)
  and (lower(a.name), lower(coalesce(a.domain, ''))) in (
    ('acme corp', 'acme.co'),
    ('globex inc', 'globex.io'),
    ('soylent corp', 'soylent.co')
  );

update public.workspaces
set seed_source = null,
    seeded_at = null,
    updated_at = now()
where coalesce(seed_source, '') in ('legacy_demo_seed', 'explicit_demo_import');
