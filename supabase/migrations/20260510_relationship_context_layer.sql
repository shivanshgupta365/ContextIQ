create table if not exists public.person_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete set null,
  person_id uuid not null references public.people(id) on delete cascade,
  source_provider text not null,
  source_user_id text,
  source_profile_url text,
  source_email text,
  source_display_name text,
  source_object_type text not null default 'person_source',
  source_object_id text not null,
  dedupe_key text not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create table if not exists public.relationship_memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete set null,
  person_id uuid not null references public.people(id) on delete cascade,
  summary text not null,
  relationship_type text not null default 'contact',
  status text not null default 'active',
  sentiment text,
  last_interaction_at timestamptz,
  topics jsonb not null default '[]'::jsonb,
  pending_actions jsonb not null default '[]'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  hydradb_memory_id text,
  source_provider text not null,
  source_object_type text not null default 'relationship_memory',
  source_object_id text not null,
  dedupe_key text not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create table if not exists public.person_thread_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete set null,
  person_id uuid not null references public.people(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null default 'participant',
  source_provider text not null,
  source_object_type text not null default 'person_thread_link',
  source_object_id text not null,
  dedupe_key text not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create table if not exists public.relationship_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete set null,
  from_entity_type text not null,
  from_entity_id uuid not null,
  edge_type text not null,
  to_entity_type text not null,
  to_entity_id uuid not null,
  weight numeric(6,3) not null default 1,
  source_refs jsonb not null default '[]'::jsonb,
  source_provider text not null,
  source_object_type text not null default 'relationship_edge',
  source_object_id text not null,
  dedupe_key text not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create index if not exists idx_person_sources_workspace_person
  on public.person_sources(workspace_id, person_id, source_provider);
create index if not exists idx_relationship_memories_workspace_person
  on public.relationship_memories(workspace_id, person_id, updated_at desc);
create index if not exists idx_person_thread_links_workspace_person
  on public.person_thread_links(workspace_id, person_id, last_seen_at desc);
create index if not exists idx_person_thread_links_workspace_conversation
  on public.person_thread_links(workspace_id, conversation_id, last_seen_at desc);
create index if not exists idx_relationship_edges_workspace_from
  on public.relationship_edges(workspace_id, from_entity_type, from_entity_id, edge_type);
create index if not exists idx_relationship_edges_workspace_to
  on public.relationship_edges(workspace_id, to_entity_type, to_entity_id, edge_type);

alter table public.person_sources enable row level security;
alter table public.relationship_memories enable row level security;
alter table public.person_thread_links enable row level security;
alter table public.relationship_edges enable row level security;

drop policy if exists "person_sources_select_member" on public.person_sources;
create policy "person_sources_select_member" on public.person_sources
for select using (public.is_workspace_member(workspace_id));

drop policy if exists "person_sources_insert_member" on public.person_sources;
create policy "person_sources_insert_member" on public.person_sources
for insert with check (public.is_workspace_member(workspace_id));

drop policy if exists "person_sources_update_member" on public.person_sources;
create policy "person_sources_update_member" on public.person_sources
for update using (public.is_workspace_member(workspace_id));

drop policy if exists "relationship_memories_select_member" on public.relationship_memories;
create policy "relationship_memories_select_member" on public.relationship_memories
for select using (public.is_workspace_member(workspace_id));

drop policy if exists "relationship_memories_insert_member" on public.relationship_memories;
create policy "relationship_memories_insert_member" on public.relationship_memories
for insert with check (public.is_workspace_member(workspace_id));

drop policy if exists "relationship_memories_update_member" on public.relationship_memories;
create policy "relationship_memories_update_member" on public.relationship_memories
for update using (public.is_workspace_member(workspace_id));

drop policy if exists "person_thread_links_select_member" on public.person_thread_links;
create policy "person_thread_links_select_member" on public.person_thread_links
for select using (public.is_workspace_member(workspace_id));

drop policy if exists "person_thread_links_insert_member" on public.person_thread_links;
create policy "person_thread_links_insert_member" on public.person_thread_links
for insert with check (public.is_workspace_member(workspace_id));

drop policy if exists "person_thread_links_update_member" on public.person_thread_links;
create policy "person_thread_links_update_member" on public.person_thread_links
for update using (public.is_workspace_member(workspace_id));

drop policy if exists "relationship_edges_select_member" on public.relationship_edges;
create policy "relationship_edges_select_member" on public.relationship_edges
for select using (public.is_workspace_member(workspace_id));

drop policy if exists "relationship_edges_insert_member" on public.relationship_edges;
create policy "relationship_edges_insert_member" on public.relationship_edges
for insert with check (public.is_workspace_member(workspace_id));

drop policy if exists "relationship_edges_update_member" on public.relationship_edges;
create policy "relationship_edges_update_member" on public.relationship_edges
for update using (public.is_workspace_member(workspace_id));

drop trigger if exists set_person_sources_updated_at on public.person_sources;
create trigger set_person_sources_updated_at
before update on public.person_sources
for each row execute function public.set_updated_at();

drop trigger if exists set_relationship_memories_updated_at on public.relationship_memories;
create trigger set_relationship_memories_updated_at
before update on public.relationship_memories
for each row execute function public.set_updated_at();

drop trigger if exists set_person_thread_links_updated_at on public.person_thread_links;
create trigger set_person_thread_links_updated_at
before update on public.person_thread_links
for each row execute function public.set_updated_at();

drop trigger if exists set_relationship_edges_updated_at on public.relationship_edges;
create trigger set_relationship_edges_updated_at
before update on public.relationship_edges
for each row execute function public.set_updated_at();

grant select, insert, update, delete on table public.person_sources to authenticated;
grant select, insert, update, delete on table public.relationship_memories to authenticated;
grant select, insert, update, delete on table public.person_thread_links to authenticated;
grant select, insert, update, delete on table public.relationship_edges to authenticated;

grant select, insert, update, delete on table public.person_sources to service_role;
grant select, insert, update, delete on table public.relationship_memories to service_role;
grant select, insert, update, delete on table public.person_thread_links to service_role;
grant select, insert, update, delete on table public.relationship_edges to service_role;
