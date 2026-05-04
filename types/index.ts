export type ActionType =
  | "prepare_meeting"
  | "draft_followup"
  | "summarize_blockers"
  | "what_changed_recently";

export type NoteSourceType =
  | "manual_note"
  | "meeting_note"
  | "call_summary"
  | "email_summary"
  | "transcript"
  | "uploaded_document"
  | "crm_import";

export type ImportanceLevel = "low" | "medium" | "high" | "critical";

export type AccountStage =
  | "prospect"
  | "discovery"
  | "evaluation"
  | "negotiation"
  | "customer"
  | "at_risk"
  | "closed_won"
  | "closed_lost";

export type AccountPriority = ImportanceLevel;

export type ContactRoleType =
  | "champion"
  | "economic_buyer"
  | "technical_buyer"
  | "procurement"
  | "end_user"
  | "decision_maker"
  | "other";

export type ActivityType =
  | "email_sent"
  | "email_received"
  | "call_logged"
  | "meeting_logged"
  | "note_added"
  | "status_changed"
  | "task_created"
  | "document_uploaded";

export interface RecalledMemoryMetadata {
  workspace_id: string;
  account_id: string;
  contact_id?: string | null;
  source_type: string;
  topic?: string | null;
  importance_level?: string | null;
  stage?: string | null;
  created_at: string;
  created_by?: string | null;
  entity_type: string;
  account_name?: string | null;
  contact_name?: string | null;
  contact_role_type?: string | null;
  integration_source?: "gmail" | "linkedin" | "outlook" | "slack" | null;
}

export interface RecalledMemory {
  id?: string;
  content: string;
  metadata: RecalledMemoryMetadata;
  score?: number;
}

export type ContextMemoryType =
  | "BLOCKER"
  | "PREFERENCE"
  | "COMMITMENT"
  | "CONTEXT";

export interface ContextRailItem {
  id: string;
  type: ContextMemoryType;
  relationLabel: string | null;
  sourceLabel: string;
  dateLabel: string;
  whyRecalled: string;
  content: string;
  accentClassName: string;
  badgeClassName: string;
  iconClassName: string;
  rawMemory: RecalledMemory;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  hydradb_tenant_id: string;
}

export interface Account {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  stage: AccountStage;
  priority: AccountPriority;
  arr_estimate: number | null;
  owner_name: string | null;
  notes_summary: string | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  workspace_id: string;
  account_id: string;
  name: string;
  email: string | null;
  title: string | null;
  role_type: ContactRoleType | null;
  communication_style: string | null;
  preference_summary: string | null;
  importance_level: ImportanceLevel;
  linkedin_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  workspace_id: string;
  account_id: string;
  contact_id: string | null;
  author_id: string | null;
  title: string | null;
  content: string;
  source_type: NoteSourceType;
  topic: string | null;
  importance_level: ImportanceLevel;
  hydradb_memory_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityRecord {
  id: string;
  workspace_id: string;
  account_id: string;
  contact_id: string | null;
  actor_id: string | null;
  activity_type: ActivityType;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
  hydradb_memory_id?: string | null;
}

export interface GeneratedOutput {
  id: string;
  workspace_id: string;
  account_id: string;
  contact_id: string | null;
  action_type: ActionType;
  prompt: string | null;
  output_text: string;
  recalled_memories_json: RecalledMemory[];
  model_name: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TimelineItem {
  id: string;
  type: "email" | "note" | "call" | "status" | "task";
  title: string;
  description?: string | null;
  dateLabel: string;
  userLabel: string;
  tag?: string | null;
  highlight?: boolean;
  accountId?: string;
  accountName?: string;
}

export interface AccountWithContacts extends Account {
  contacts: Contact[];
}

export interface AccountPageData {
  account: Account;
  contacts: Contact[];
  activities: ActivityRecord[];
  notes: Note[];
  timeline: TimelineItem[];
  latest_output: GeneratedOutput | null;
  recent_outputs: GeneratedOutput[];
  memory_rail: RecalledMemory[];
}

export interface WorkspaceOverviewData {
  workspace: Workspace;
  profile: Profile;
  accounts: Account[];
  contacts: Contact[];
  recent_activities: ActivityRecord[];
  recent_notes: Note[];
  recent_outputs: GeneratedOutput[];
}

export interface OverviewCardSignal {
  title: string;
  subtitle: string;
  account_id?: string;
}

export interface ComposerResult {
  output: GeneratedOutput;
  memories: RecalledMemory[];
  draft_preview?: string;
  send_confirmation_required?: boolean;
}

export interface GmailIntegration {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  email: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_type: string | null;
  scopes: string[];
  expires_at: string | null;
  connected_at: string;
  last_synced_at: string | null;
  sync_status: "idle" | "syncing" | "ok" | "error";
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface GmailIntegrationStatus {
  connected: boolean;
  email: string | null;
  last_synced_at: string | null;
  sync_status: "idle" | "syncing" | "ok" | "error";
  last_error: string | null;
}

export interface GmailSyncResult {
  fetched: number;
  imported: number;
  skipped: number;
  failed: number;
}

export interface LinkedInIntegration {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  linkedin_sub: string | null;
  email: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_type: string | null;
  scopes: string[];
  expires_at: string | null;
  connected_at: string;
  last_synced_at: string | null;
  sync_status: "idle" | "syncing" | "ok" | "error";
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkedInIntegrationStatus {
  connected: boolean;
  email: string | null;
  linkedin_sub: string | null;
  last_synced_at: string | null;
  sync_status: "idle" | "syncing" | "ok" | "error";
  last_error: string | null;
}

export interface LinkedInSyncResult {
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
}

export interface OutlookIntegration {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  email: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_type: string | null;
  scopes: string[];
  expires_at: string | null;
  connected_at: string;
  last_synced_at: string | null;
  sync_status: "idle" | "syncing" | "ok" | "error";
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutlookIntegrationStatus {
  connected: boolean;
  email: string | null;
  last_synced_at: string | null;
  sync_status: "idle" | "syncing" | "ok" | "error";
  last_error: string | null;
}

export interface OutlookSyncResult {
  fetched: number;
  imported: number;
  skipped: number;
  failed: number;
}

export interface SlackIntegration {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  email: string | null;
  team_id: string | null;
  team_name: string | null;
  enterprise_id: string | null;
  slack_user_id: string | null;
  user_access_token_encrypted: string | null;
  bot_access_token_encrypted: string | null;
  user_token_type: string | null;
  bot_token_type: string | null;
  user_scopes: string[];
  bot_scopes: string[];
  connected_at: string;
  last_synced_at: string | null;
  sync_status: "idle" | "syncing" | "ok" | "error";
  last_error: string | null;
  needs_reconnect: boolean;
  created_at: string;
  updated_at: string;
}

export interface SlackIntegrationStatus {
  connected: boolean;
  email: string | null;
  team_id: string | null;
  team_name: string | null;
  slack_user_id: string | null;
  needs_reconnect: boolean;
  last_synced_at: string | null;
  sync_status: "idle" | "syncing" | "ok" | "error";
  last_error: string | null;
}

export interface SlackSyncResult {
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
}

export interface GmailFollowUpDraftResult {
  draft_preview: string;
  send_confirmation_required: true;
  generated_output_id: string;
  suggested_subject: string;
  to_email: string;
}

export interface GmailSendResult {
  message_id: string;
  thread_id: string | null;
  label_ids: string[];
  generated_output_id: string;
}

export type IntegrationProvider =
  | "gmail"
  | "outlook"
  | "slack"
  | "twilio"
  | "linkedin"
  | "google_calendar"
  | "zoom"
  | "hubspot"
  | "salesforce"
  | "intercom"
  | "notion"
  | "resend";

export type IntegrationConnectionStatus =
  | "connected"
  | "pending_approval"
  | "error"
  | "disconnected";

export interface IntegrationCapability {
  key:
    | "search"
    | "read"
    | "sync"
    | "draft"
    | "send"
    | "writeback"
    | "webhook_ingest";
  supported: boolean;
  reason?: string | null;
}

export interface IntegrationConnection {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  provider: IntegrationProvider;
  display_name: string | null;
  status: IntegrationConnectionStatus;
  capabilities: IntegrationCapability[];
  permission_scope: string | null;
  source_provider: string;
  source_object_type: string;
  source_object_id: string;
  dedupe_key: string;
  raw_payload_ref: string | null;
  normalized_payload: Record<string, unknown>;
  embedding_status: string;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationSyncRun {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  integration_connection_id: string | null;
  provider: IntegrationProvider;
  status: "started" | "ok" | "partial" | "error";
  imported_count: number;
  skipped_count: number;
  failed_count: number;
  details: Record<string, unknown>;
  source_provider: string;
  source_object_type: string;
  source_object_id: string;
  dedupe_key: string;
  raw_payload_ref: string | null;
  normalized_payload: Record<string, unknown>;
  embedding_status: string;
  permission_scope: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface UnifiedObjectRef {
  entity_type:
    | "organization"
    | "person"
    | "conversation"
    | "message"
    | "meeting"
    | "deal"
    | "ticket"
    | "task"
    | "note"
    | "document"
    | "activity"
    | "generated_output";
  entity_id: string;
  provider?: IntegrationProvider | null;
}

export interface IdentityAlias {
  id: string;
  workspace_id: string;
  owner_user_id: string | null;
  person_id: string;
  provider: IntegrationProvider;
  alias_type: string;
  alias_value: string;
  source_provider: string;
  source_object_type: string;
  source_object_id: string;
  dedupe_key: string;
  raw_payload_ref: string | null;
  normalized_payload: Record<string, unknown>;
  embedding_status: string;
  permission_scope: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  id: string;
  workspace_id: string;
  owner_user_id: string | null;
  organization_id: string | null;
  person_id: string | null;
  event_type: string;
  summary: string;
  occurred_at: string;
  source_provider: string;
  source_object_type: string;
  source_object_id: string;
  dedupe_key: string;
  raw_payload_ref: string | null;
  normalized_payload: Record<string, unknown>;
  embedding_status: string;
  permission_scope: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface ActionExecution {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  action_type: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  writeback_provider: IntegrationProvider | null;
  writeback_ref: string | null;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown>;
  ai_generated: boolean;
  approval_state: "auto_executed" | "approved" | "rejected";
  source_provider: string;
  source_object_type: string;
  source_object_id: string;
  dedupe_key: string;
  raw_payload_ref: string | null;
  normalized_payload: Record<string, unknown>;
  embedding_status: string;
  permission_scope: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderReadinessStatus {
  provider: IntegrationProvider;
  status: IntegrationConnectionStatus;
  capabilities: IntegrationCapability[];
  last_synced_at: string | null;
  message: string;
}

export interface CommandSearchRequest {
  workspaceId: string;
  hydraTenantId?: string | null;
  query: string;
  accountId?: string | null;
  personId?: string | null;
  timeframeDays?: number;
  limit?: number;
}

export interface CommandSearchHit {
  id: string;
  type: UnifiedObjectRef["entity_type"];
  title: string;
  snippet: string;
  provider?: IntegrationProvider | null;
  occurredAt?: string | null;
  relevance: number;
  ref: UnifiedObjectRef;
}

export interface CommandSearchResponse {
  query: string;
  hits: CommandSearchHit[];
}

export interface CrossToolActionRequest {
  workspaceId: string;
  actionType:
    | "send_email"
    | "draft_email"
    | "post_slack"
    | "create_calendar_event"
    | "reply_intercom"
    | "create_crm_task"
    | "update_crm_record"
    | "send_sms"
    | "create_notion_brief";
  targetAccountId?: string | null;
  targetPersonId?: string | null;
  payload: Record<string, unknown>;
}

export interface CrossToolActionResponse {
  actionExecution: ActionExecution;
  providerStatus: ProviderReadinessStatus;
}
