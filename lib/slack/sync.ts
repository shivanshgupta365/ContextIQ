import { addMemories, buildNoteMemoryPayload } from "@/lib/hydradb/client";
import { logIntegrationEvent } from "@/lib/integrations/telemetry";
import {
  listSlackChannelMessages,
  listSlackConversations,
} from "@/lib/slack/client";
import {
  getDecryptedSlackIntegration,
  updateSlackSyncState,
} from "@/lib/slack/integration-store";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Account, Contact, Note, SlackSyncResult, Workspace } from "@/types";
import {
  ensureAccountForEmail,
  ensureContactForEmail,
  ensureConversationProjection,
  ensureIdentityAlias,
  ensureOrganizationForAccount,
  ensurePersonProjection,
  normalizeDomain,
  upsertMessageProjection,
  upsertSearchIndexEntry,
} from "@/lib/workspace/projections";
import { upsertPersonRelationshipContext } from "@/lib/context/relationship-updater";

function extractPossibleEmails(value: string) {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

export async function syncWorkspaceSlackSignals(input: {
  userId: string;
  workspace: Workspace;
  maxChannels?: number;
  maxMessagesPerChannel?: number;
}): Promise<SlackSyncResult> {
  const supabase = getSupabaseAdminClient();
  const maxChannels = Math.min(Math.max(input.maxChannels ?? 8, 1), 20);
  const maxMessagesPerChannel = Math.min(Math.max(input.maxMessagesPerChannel ?? 10, 1), 25);

  const integration = await getDecryptedSlackIntegration({
    workspaceId: input.workspace.id,
    userId: input.userId,
  });

  if (!integration) {
    throw new Error("Slack is not connected. Connect Slack first.");
  }

  const accessToken = integration.user_access_token ?? integration.bot_access_token;
  const usingBotFallback = !integration.user_access_token && Boolean(integration.bot_access_token);
  if (!accessToken) {
    throw new Error("Slack token missing. Reconnect Slack.");
  }

  await updateSlackSyncState({
    workspaceId: input.workspace.id,
    userId: input.userId,
    syncStatus: "syncing",
    lastError: null,
  });

  try {
    const [{ data: accounts }, { data: contacts }, { data: existingSyncs }] = await Promise.all([
      supabase.from("accounts").select("*").eq("workspace_id", input.workspace.id),
      supabase.from("contacts").select("*").eq("workspace_id", input.workspace.id),
      supabase
        .from("slack_message_syncs")
        .select("slack_channel_id,slack_message_ts")
        .eq("workspace_id", input.workspace.id)
        .eq("user_id", input.userId),
    ]);

    const typedAccounts = (accounts ?? []) as Account[];
    const typedContacts = (contacts ?? []) as Contact[];

    const accountByDomain = new Map<string, Account>();
    typedAccounts.forEach((account) => {
      const domain = normalizeDomain(account.domain);
      if (domain) accountByDomain.set(domain, account);
    });

    const contactByEmail = new Map<string, Contact>();
    typedContacts.forEach((contact) => {
      if (contact.email) contactByEmail.set(contact.email.toLowerCase(), contact);
    });

    const existingKeys = new Set(
      ((existingSyncs ?? []) as Array<{ slack_channel_id: string; slack_message_ts: string }>).map(
        (row) => `${row.slack_channel_id}:${row.slack_message_ts}`,
      ),
    );

    const channels = await listSlackConversations({
      accessToken,
      maxChannels,
    });

    const result: SlackSyncResult = {
      scanned: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
    };

    for (const channel of channels) {
      const messages = await listSlackChannelMessages({
        accessToken,
        channelId: channel.id,
        limit: maxMessagesPerChannel,
      });

      for (const message of messages) {
        result.scanned += 1;
        const syncKey = `${channel.id}:${message.id}`;
        if (existingKeys.has(syncKey)) {
          result.skipped += 1;
          continue;
        }

        try {
          const emails = extractPossibleEmails(message.text);
          let matchedContact = emails
            .map((email) => contactByEmail.get(email))
            .find(Boolean) as Contact | undefined;

          const matchedContactAccountId = matchedContact?.account_id ?? null;
          let matchedAccount =
            (matchedContactAccountId
              ? typedAccounts.find((account) => account.id === matchedContactAccountId)
              : null) ??
            emails
              .map((email) => {
                const domain = normalizeDomain(email.split("@")[1] ?? "");
                return domain ? accountByDomain.get(domain) : null;
              })
              .find(Boolean) ??
            null;

          if (!matchedAccount && emails[0]) {
            matchedAccount = await ensureAccountForEmail({
              workspaceId: input.workspace.id,
              userId: input.userId,
              email: emails[0],
              provider: "slack",
            }).catch(() => null);
            if (matchedAccount?.domain) {
              typedAccounts.push(matchedAccount);
              accountByDomain.set(normalizeDomain(matchedAccount.domain)!, matchedAccount);
            }
          }

          if (!matchedContact && emails[0] && matchedAccount) {
            matchedContact = await ensureContactForEmail({
              workspaceId: input.workspace.id,
              accountId: matchedAccount.id,
              email: emails[0],
            });
            if (matchedContact.email) {
              typedContacts.push(matchedContact);
              contactByEmail.set(matchedContact.email.toLowerCase(), matchedContact);
            }
          }

          const organization = matchedAccount
            ? await ensureOrganizationForAccount({
                workspaceId: input.workspace.id,
                userId: input.userId,
                account: matchedAccount,
                provider: "slack",
              })
            : null;
          const person = matchedContact
            ? await ensurePersonProjection({
                workspaceId: input.workspace.id,
                userId: input.userId,
                provider: "slack",
                organizationId: organization?.id ?? null,
                contact: matchedContact,
                sourceObjectId: matchedContact.id,
              })
            : null;

          if (person && matchedContact?.email) {
            await ensureIdentityAlias({
              workspaceId: input.workspace.id,
              userId: input.userId,
              personId: person.id,
              provider: "slack",
              aliasType: "email",
              aliasValue: matchedContact.email,
              sourceProvider: "slack",
              sourceObjectId: syncKey,
            });
          }

          const conversation = await ensureConversationProjection({
            workspaceId: input.workspace.id,
            userId: input.userId,
            provider: "slack",
            organizationId: organization?.id ?? null,
            personId: person?.id ?? null,
            channel: channel.name,
            subject: `Slack #${channel.name}`,
            lastMessageAt: message.occurredAt,
            sourceObjectId: channel.id,
            normalizedPayload: {
              provider: "slack",
              slack_channel_id: channel.id,
              slack_channel_name: channel.name,
            },
          });

          const projectedMessage = await upsertMessageProjection({
            workspaceId: input.workspace.id,
            userId: input.userId,
            provider: "slack",
            conversationId: conversation.id,
            organizationId: organization?.id ?? null,
            personId: person?.id ?? null,
            sourceObjectId: syncKey,
            direction: "internal",
            body: message.text || "(empty Slack message)",
            sentAt: message.occurredAt,
            normalizedPayload: {
              provider: "slack",
              slack_channel_id: channel.id,
              slack_channel_name: channel.name,
              slack_user_id: message.userId,
            },
          });

          if (person) {
            await upsertPersonRelationshipContext({
              workspaceId: input.workspace.id,
              userId: input.userId,
              provider: "slack",
              personId: person.id,
              personEmail: matchedContact?.email ?? null,
              personName: matchedContact?.name ?? null,
              sourceObjectId: syncKey,
              sourceUserId: message.userId,
              conversationId: conversation.id,
              accountId: matchedAccount?.id ?? null,
              interactionAt: message.occurredAt,
              content: message.text || "(empty Slack message)",
              role: "participant",
              sourceRefs: [
                {
                  source: "slack",
                  ref_id: syncKey,
                  label: `#${channel.name}`,
                  occurred_at: message.occurredAt,
                },
              ],
            }).catch((relationshipError) => {
              console.error("Slack relationship context upsert failed", relationshipError);
            });
          }

          await upsertSearchIndexEntry({
            workspaceId: input.workspace.id,
            userId: input.userId,
            entityType: "message",
            entityId: projectedMessage.id,
            title: `Slack #${channel.name}`,
            body: message.text || "(empty Slack message)",
            provider: "slack",
            sourceObjectId: syncKey,
            metadata: {
              provider: "slack",
              conversation_id: conversation.id,
              account_id: matchedAccount?.id ?? null,
              person_id: person?.id ?? null,
            },
          });

          let activityId: string | null = null;
          let noteId: string | null = null;

          if (matchedAccount) {
            const activityInsert = await supabase
              .from("activities")
              .insert({
                workspace_id: input.workspace.id,
                account_id: matchedAccount.id,
                contact_id: matchedContact?.id ?? null,
                actor_id: input.userId,
                activity_type: "note_added",
                title: `Slack signal synced from #${channel.name}`,
                description: message.text || null,
                occurred_at: message.occurredAt,
                metadata: {
                  topic: "slack_message",
                  integration_source: "slack",
                  slack_channel_id: channel.id,
                  slack_channel_name: channel.name,
                  slack_message_ts: message.id,
                  slack_user_id: message.userId,
                },
              })
              .select("id,title,description")
              .single();

            if (activityInsert.error || !activityInsert.data) {
              throw activityInsert.error ?? new Error("Failed to insert Slack activity.");
            }

            activityId = activityInsert.data.id;

            await upsertSearchIndexEntry({
              workspaceId: input.workspace.id,
              userId: input.userId,
              entityType: "activity",
              entityId: activityInsert.data.id,
              title: activityInsert.data.title,
              body: message.text || "(empty Slack message)",
              provider: "slack",
              sourceObjectId: activityInsert.data.id,
              metadata: {
                provider: "slack",
                account_id: matchedAccount.id,
                contact_id: matchedContact?.id ?? null,
              },
            });

            const noteInsert = await supabase
              .from("notes")
              .insert({
                workspace_id: input.workspace.id,
                account_id: matchedAccount.id,
                contact_id: matchedContact?.id ?? null,
                author_id: input.userId,
                title: `Slack signal: #${channel.name}`,
                content: message.text || "(empty Slack message)",
                source_type: "transcript",
                topic: "slack_message",
                importance_level: "medium",
              })
              .select("*")
              .single();

            if (noteInsert.error || !noteInsert.data) {
              throw noteInsert.error ?? new Error("Failed to insert Slack note.");
            }

            const insertedNote = noteInsert.data as Note;
            noteId = insertedNote.id;

            try {
              const hydraResponse = await addMemories({
                tenantId: input.workspace.hydradb_tenant_id,
                memories: [
                  buildNoteMemoryPayload({
                    note: insertedNote,
                    account: matchedAccount,
                    contact: matchedContact ?? null,
                    userId: input.userId,
                  }),
                ],
              });

              const memoryId = hydraResponse.memory_ids?.[0] ?? hydraResponse.ids?.[0] ?? null;
              if (memoryId) {
                await supabase.from("notes").update({ hydradb_memory_id: memoryId }).eq("id", insertedNote.id);
              }
            } catch (ingestError) {
              console.error("HydraDB Slack note ingestion failed", ingestError);
            }

            await upsertSearchIndexEntry({
              workspaceId: input.workspace.id,
              userId: input.userId,
              entityType: "note",
              entityId: insertedNote.id,
              title: insertedNote.title,
              body: insertedNote.content,
              provider: "slack",
              sourceObjectId: insertedNote.id,
              metadata: {
                provider: "slack",
                account_id: matchedAccount.id,
                contact_id: matchedContact?.id ?? null,
              },
            });
          }

          const syncInsert = await supabase.from("slack_message_syncs").insert({
            workspace_id: input.workspace.id,
            user_id: input.userId,
            slack_channel_id: channel.id,
            slack_channel_name: channel.name,
            slack_message_ts: message.id,
            account_id: matchedAccount?.id ?? null,
            contact_id: matchedContact?.id ?? null,
            activity_id: activityId,
            note_id: noteId,
          });

          if (syncInsert.error) {
            throw syncInsert.error;
          }

          existingKeys.add(syncKey);
          result.imported += 1;
        } catch (messageError) {
          console.error("Slack message sync failed", messageError);
          result.failed += 1;
        }
      }
    }

    await updateSlackSyncState({
      workspaceId: input.workspace.id,
      userId: input.userId,
      syncStatus: "ok",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    });

    logIntegrationEvent({
      source: "slack",
      event: "slack_sync_completed",
      workspaceId: input.workspace.id,
      userId: input.userId,
      detail: {
        token_mode: usingBotFallback ? "bot_fallback" : "user_token",
        scanned: result.scanned,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    return result;
  } catch (error) {
    await updateSlackSyncState({
      workspaceId: input.workspace.id,
      userId: input.userId,
      syncStatus: "error",
      lastError: error instanceof Error ? error.message : "Slack sync failed.",
    });

    throw error;
  }
}
