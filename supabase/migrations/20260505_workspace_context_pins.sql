create table if not exists public.workspace_context_pins (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete set null,
  entity_type text not null check (entity_type in ('account', 'contact')),
  entity_id uuid not null,
  title text not null,
  subtitle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, entity_type, entity_id)
);

create index if not exists idx_workspace_context_pins_workspace_updated
  on public.workspace_context_pins(workspace_id, updated_at desc);

drop trigger if exists set_workspace_context_pins_updated_at on public.workspace_context_pins;
create trigger set_workspace_context_pins_updated_at
before update on public.workspace_context_pins
for each row execute function public.set_updated_at();

alter table public.workspace_context_pins enable row level security;

drop policy if exists "workspace_context_pins_select_member" on public.workspace_context_pins;
create policy "workspace_context_pins_select_member" on public.workspace_context_pins
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_context_pins_insert_member" on public.workspace_context_pins;
create policy "workspace_context_pins_insert_member" on public.workspace_context_pins
  for insert with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_context_pins_update_member" on public.workspace_context_pins;
create policy "workspace_context_pins_update_member" on public.workspace_context_pins
  for update using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_context_pins_delete_member" on public.workspace_context_pins;
create policy "workspace_context_pins_delete_member" on public.workspace_context_pins
  for delete using (public.is_workspace_member(workspace_id));
