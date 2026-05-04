import { addMemories, buildNoteMemoryPayload } from "@/lib/hydradb/client";
import {
  getGmailMessageMetadata,
  listGmailMessageIds,
} from "@/lib/gmail/client";
import {
  getValidGmailAccessToken,
  updateGmailSyncState,
} from "@/lib/gmail/integration-store";
import { logIntegrationEvent } from "@/lib/integrations/telemetry";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Account, Contact, GmailSyncResult, Note, Workspace } from "@/types";
import {
  ensureAccountForEmail,
  ensureContactForEmail,
  ensureConversationProjection,
  ensureIdentityAlias,
  ensureOrganizationForAccount,
  ensurePersonProjection,
  normalizeDomain,
  parseRecipientLabel,
  upsertMessageProjection,
  upsertSearchIndexEntry,
} from "@/lib/workspace/projections";

const DEFAULT_GMAIL_QUERY = "in:anywhere newer_than:30d -in:spam -in:trash";

function extractDomain(email: string) {
  return normalizeDomain(email.split("@")[1] ?? "");
}

function toIsoFromMaybeDate(value: string | null, fallbackIso: string) {
  if (!value) return fallbackIso;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallbackIso : parsed.toISOString();
}

export async function syncWorkspaceGmailMessages(input: {
  userId: string;
  workspace: Workspace;
  maxResults?: number;
}): Promise<GmailSyncResult> {
  const supabase = getSupabaseAdminClient();
  const maxResults = Math.min(Math.max(input.maxResults ?? 20, 1), 50);

  const tokenState = await getValidGmailAccessToken({
    workspaceId: input.workspace.id,
    userId: input.userId,
  });

  await updateGmailSyncState({
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
        .from("gmail_message_syncs")
        .select("gmail_message_id")
        .eq("workspace_id", input.workspace.id)
        .eq("user_id", input.userId),
    ]);

    const typedAccounts = (accounts ?? []) as Account[];
    const typedContacts = (contacts ?? []) as Contact[];
    const existingMessageIds = new Set(
      ((existingSyncs ?? []) as Array<{ gmail_message_id: string }>).map(
        (row) => row.gmail_message_id,
      ),
    );

    const accountByDomain = new Map<string, Account>();
    typedAccounts.forEach((account) => {
      const domain = normalizeDomain(account.domain);
      if (domain) {
        accountByDomain.set(domain, account);
      }
    });

    const contactByEmail = new Map<string, Contact>();
    typedContacts.forEach((contact) => {
      if (contact.email) {
        contactByEmail.set(contact.email.toLowerCase(), contact);
      }
    });

    const messages = await listGmailMessageIds({
      accessToken: tokenState.accessToken,
      query: DEFAULT_GMAIL_QUERY,
      maxResults,
    });

    const result: GmailSyncResult = {
      fetched: messages.length,
      imported: 0,
      skipped: 0,
      failed: 0,
    };

    logIntegrationEvent({
      source: "gmail",
      event: "sync_started",
      workspaceId: input.workspace.id,
      userId: input.userId,
      detail: { fetched_candidates: messages.length },
    });

    for (const messageRef of messages) {
      if (existingMessageIds.has(messageRef.id)) {
        result.skipped += 1;
        continue;
      }

      try {
        const message = await getGmailMessageMetadata({
          accessToken: tokenState.accessToken,
          messageId: messageRef.id,
        });

        const occurredAt = message.internalDate
          ? new Date(Number(message.internalDate)).toISOString()
          : toIsoFromMaybeDate(message.date, new Date().toISOString());
        const ownerEmail = tokenState.integration.email?.toLowerCase() ?? null;
        const involvedEmails = [...message.fromEmails, ...message.toEmails];
        const externalEmails = involvedEmails.filter((email) => email !== ownerEmail);
        const primaryExternalEmail = externalEmails[0] ?? null;
        const fromIdentity = parseRecipientLabel(message.from);

        let matchedContact = involvedEmails
          .map((email) => contactByEmail.get(email))
          .find(Boolean) as Contact | undefined;

        const matchedContactAccountId = matchedContact?.account_id ?? null;
        let matchedAccount =
          (matchedContactAccountId
            ? typedAccounts.find((account) => account.id === matchedContactAccountId)
            : null) ??
          involvedEmails
            .map((email) => {
              const domain = extractDomain(email);
              return domain ? accountByDomain.get(domain) : null;
            })
            .find(Boolean) ??
          null;

        if (!matchedAccount && primaryExternalEmail) {
          matchedAccount = await ensureAccountForEmail({
            workspaceId: input.workspace.id,
            userId: input.userId,
            email: primaryExternalEmail,
            provider: "gmail",
            nameHint: fromIdentity.email === primaryExternalEmail ? fromIdentity.name : null,
          });
          if (matchedAccount) {
            typedAccounts.push(matchedAccount);
            if (matchedAccount.domain) {
              accountByDomain.set(normalizeDomain(matchedAccount.domain)!, matchedAccount);
            }
          }
        }

        if (!matchedContact && primaryExternalEmail && matchedAccount) {
          matchedContact = await ensureContactForEmail({
            workspaceId: input.workspace.id,
            accountId: matchedAccount.id,
            email: primaryExternalEmail,
            name: fromIdentity.email === primaryExternalEmail ? fromIdentity.name : null,
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
              provider: "gmail",
            })
          : null;
        const person = matchedContact
          ? await ensurePersonProjection({
              workspaceId: input.workspace.id,
              userId: input.userId,
              provider: "gmail",
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
            provider: "gmail",
            aliasType: "email",
            aliasValue: matchedContact.email,
            sourceProvider: "gmail",
            sourceObjectId: message.id,
          });
        }

        const conversation = await ensureConversationProjection({
          workspaceId: input.workspace.id,
          userId: input.userId,
          provider: "gmail",
          organizationId: organization?.id ?? null,
          personId: person?.id ?? null,
          channel: "email",
          subject: message.subject ?? "Gmail thread",
          lastMessageAt: occurredAt,
          sourceObjectId: message.threadId ?? message.id,
          normalizedPayload: {
            provider: "gmail",
            from: message.from,
            to: message.to,
            cc: message.cc,
          },
        });

        const projectedMessage = await upsertMessageProjection({
          workspaceId: input.workspace.id,
          userId: input.userId,
          provider: "gmail",
          conversationId: conversation.id,
          organizationId: organization?.id ?? null,
          personId: person?.id ?? null,
          sourceObjectId: message.id,
          direction: "inbound",
          body: message.snippet || message.subject || "Email message",
          sentAt: occurredAt,
          normalizedPayload: {
            provider: "gmail",
            thread_id: message.threadId,
            from: message.from,
            to: message.to,
            cc: message.cc,
            label_ids: message.labelIds,
          },
        });

        await upsertSearchIndexEntry({
          workspaceId: input.workspace.id,
          userId: input.userId,
          entityType: "message",
          entityId: projectedMessage.id,
          title: message.subject ?? "Gmail message",
          body: [message.subject, message.snippet, message.from, message.to, message.cc]
            .filter(Boolean)
            .join("\n"),
          provider: "gmail",
          sourceObjectId: message.id,
          metadata: {
            provider: "gmail",
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
              activity_type: "email_received",
              title: message.subject?.trim() || "Email update synced from Gmail",
              description: message.snippet || null,
              occurred_at: occurredAt,
              metadata: {
                topic: "gmail_email",
                integration_source: "gmail",
                gmail_message_id: message.id,
                gmail_thread_id: message.threadId,
                gmail_label_ids: message.labelIds,
                from: message.from,
                to: message.to,
                cc: message.cc,
              },
            })
            .select("*")
            .single();

          if (activityInsert.error || !activityInsert.data) {
            throw activityInsert.error ?? new Error("Failed to insert Gmail activity.");
          }

          activityId = activityInsert.data.id;

          await upsertSearchIndexEntry({
            workspaceId: input.workspace.id,
            userId: input.userId,
            entityType: "activity",
            entityId: activityInsert.data.id,
            title: activityInsert.data.title,
            body: [activityInsert.data.title, activityInsert.data.description]
              .filter(Boolean)
              .join("\n"),
            provider: "gmail",
            sourceObjectId: activityInsert.data.id,
            metadata: {
              provider: "gmail",
              account_id: matchedAccount.id,
              contact_id: matchedContact?.id ?? null,
            },
          });

          const noteContent = [
            message.subject ? `Subject: ${message.subject}` : null,
            message.from ? `From: ${message.from}` : null,
            message.to ? `To: ${message.to}` : null,
            message.snippet ? `Summary: ${message.snippet}` : null,
          ]
            .filter(Boolean)
            .join("\n");

          if (noteContent.length >= 12) {
            const noteInsert = await supabase
              .from("notes")
              .insert({
                workspace_id: input.workspace.id,
                account_id: matchedAccount.id,
                contact_id: matchedContact?.id ?? null,
                author_id: input.userId,
                title: message.subject?.trim() || "Email summary",
                content: noteContent,
                source_type: "email_summary",
                topic: "gmail_email",
                importance_level: "medium",
              })
              .select("*")
              .single();

            if (noteInsert.error || !noteInsert.data) {
              throw noteInsert.error ?? new Error("Failed to insert Gmail note.");
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
              console.error("HydraDB Gmail note ingestion failed", ingestError);
            }

            await upsertSearchIndexEntry({
              workspaceId: input.workspace.id,
              userId: input.userId,
              entityType: "note",
              entityId: insertedNote.id,
              title: insertedNote.title ?? message.subject ?? "Gmail note",
              body: insertedNote.content,
              provider: "gmail",
              sourceObjectId: insertedNote.id,
              metadata: {
                provider: "gmail",
                account_id: matchedAccount.id,
                contact_id: matchedContact?.id ?? null,
              },
            });
          }
        }

        const syncInsert = await supabase.from("gmail_message_syncs").insert({
          workspace_id: input.workspace.id,
          user_id: input.userId,
          gmail_message_id: message.id,
          gmail_thread_id: message.threadId,
          account_id: matchedAccount?.id ?? null,
          contact_id: matchedContact?.id ?? null,
          activity_id: activityId,
          note_id: noteId,
        });

        if (syncInsert.error) {
          throw syncInsert.error;
        }

        existingMessageIds.add(message.id);
        result.imported += 1;
      } catch (messageError) {
        console.error("Gmail message sync failed", messageError);
        result.failed += 1;
      }
    }

    await updateGmailSyncState({
      workspaceId: input.workspace.id,
      userId: input.userId,
      syncStatus: "ok",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    });

    logIntegrationEvent({
      source: "gmail",
      event: "sync_completed",
      workspaceId: input.workspace.id,
      userId: input.userId,
      detail: result as unknown as Record<string, unknown>,
    });

    return result;
  } catch (error) {
    await updateGmailSyncState({
      workspaceId: input.workspace.id,
      userId: input.userId,
      syncStatus: "error",
      lastError: error instanceof Error ? error.message : "Gmail sync failed.",
    });

    throw error;
  }
}
