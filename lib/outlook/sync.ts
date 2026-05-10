import { addMemories, buildNoteMemoryPayload } from "@/lib/hydradb/client";
import { logIntegrationEvent } from "@/lib/integrations/telemetry";
import {
  listOutlookCalendarEvents,
  listOutlookMessages,
} from "@/lib/outlook/client";
import {
  getValidOutlookAccessToken,
  updateOutlookSyncState,
} from "@/lib/outlook/integration-store";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Account, Contact, Note, OutlookSyncResult, Workspace } from "@/types";
import {
  ensureAccountForEmail,
  ensureContactForEmail,
  ensureConversationProjection,
  ensureIdentityAlias,
  ensureOrganizationForAccount,
  ensurePersonProjection,
  normalizeDomain,
  parseRecipientLabel,
  upsertMeetingProjection,
  upsertMessageProjection,
  upsertSearchIndexEntry,
} from "@/lib/workspace/projections";
import { upsertPersonRelationshipContext } from "@/lib/context/relationship-updater";

function extractDomain(email: string) {
  return normalizeDomain(email.split("@")[1] ?? "");
}

export async function syncWorkspaceOutlookMessages(input: {
  userId: string;
  workspace: Workspace;
  maxResults?: number;
}): Promise<OutlookSyncResult & { meetings_imported: number }> {
  const supabase = getSupabaseAdminClient();
  const maxResults = Math.min(Math.max(input.maxResults ?? 20, 1), 50);

  const tokenState = await getValidOutlookAccessToken({
    workspaceId: input.workspace.id,
    userId: input.userId,
  });

  await updateOutlookSyncState({
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
        .from("outlook_message_syncs")
        .select("outlook_message_id")
        .eq("workspace_id", input.workspace.id)
        .eq("user_id", input.userId),
    ]);

    const typedAccounts = (accounts ?? []) as Account[];
    const typedContacts = (contacts ?? []) as Contact[];
    const existingMessageIds = new Set(
      ((existingSyncs ?? []) as Array<{ outlook_message_id: string }>).map(
        (row) => row.outlook_message_id,
      ),
    );

    const accountByDomain = new Map<string, Account>();
    typedAccounts.forEach((account) => {
      const domain = normalizeDomain(account.domain);
      if (domain) accountByDomain.set(domain, account);
    });

    const contactByEmail = new Map<string, Contact>();
    typedContacts.forEach((contact) => {
      if (contact.email) contactByEmail.set(contact.email.toLowerCase(), contact);
    });

    const [messages, events] = await Promise.all([
      listOutlookMessages({
        accessToken: tokenState.accessToken,
        maxResults,
      }),
      listOutlookCalendarEvents({
        accessToken: tokenState.accessToken,
        maxResults: Math.max(10, Math.floor(maxResults / 2)),
      }).catch(() => []),
    ]);

    const result: OutlookSyncResult & { meetings_imported: number } = {
      fetched: messages.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      meetings_imported: 0,
    };

    logIntegrationEvent({
      source: "outlook",
      event: "outlook_sync_started",
      workspaceId: input.workspace.id,
      userId: input.userId,
      detail: { fetched_candidates: messages.length, fetched_events: events.length },
    });

    for (const message of messages) {
      if (existingMessageIds.has(message.id)) {
        result.skipped += 1;
        continue;
      }

      try {
        const occurredAt = message.receivedAt ?? new Date().toISOString();
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
            provider: "outlook",
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
              provider: "outlook",
            })
          : null;
        const person = matchedContact
          ? await ensurePersonProjection({
              workspaceId: input.workspace.id,
              userId: input.userId,
              provider: "outlook",
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
            provider: "outlook",
            aliasType: "email",
            aliasValue: matchedContact.email,
            sourceProvider: "outlook",
            sourceObjectId: message.id,
          });
        }

        const conversation = await ensureConversationProjection({
          workspaceId: input.workspace.id,
          userId: input.userId,
          provider: "outlook",
          organizationId: organization?.id ?? null,
          personId: person?.id ?? null,
          channel: "email",
          subject: message.subject ?? "Outlook thread",
          lastMessageAt: occurredAt,
          sourceObjectId: message.threadId ?? message.id,
          normalizedPayload: {
            provider: "outlook",
            from: message.from,
            to: message.to,
            cc: message.cc,
          },
        });

        const projectedMessage = await upsertMessageProjection({
          workspaceId: input.workspace.id,
          userId: input.userId,
          provider: "outlook",
          conversationId: conversation.id,
          organizationId: organization?.id ?? null,
          personId: person?.id ?? null,
          sourceObjectId: message.id,
          direction: "inbound",
          body: message.snippet || message.subject || "Outlook message",
          sentAt: occurredAt,
          normalizedPayload: {
            provider: "outlook",
            thread_id: message.threadId,
            from: message.from,
            to: message.to,
            cc: message.cc,
          },
        });

        if (person) {
          await upsertPersonRelationshipContext({
            workspaceId: input.workspace.id,
            userId: input.userId,
            provider: "outlook",
            personId: person.id,
            personEmail: matchedContact?.email ?? null,
            personName: matchedContact?.name ?? null,
            sourceObjectId: message.id,
            conversationId: conversation.id,
            accountId: matchedAccount?.id ?? null,
            interactionAt: occurredAt,
            content: message.snippet || message.subject || "Outlook message context",
            role: "participant",
            sourceRefs: [
              {
                source: "outlook",
                ref_id: message.id,
                label: message.subject ?? "Outlook message",
                occurred_at: occurredAt,
              },
            ],
          }).catch((relationshipError) => {
            console.error("Outlook relationship context upsert failed", relationshipError);
          });
        }

        await upsertSearchIndexEntry({
          workspaceId: input.workspace.id,
          userId: input.userId,
          entityType: "message",
          entityId: projectedMessage.id,
          title: message.subject ?? "Outlook message",
          body: [message.subject, message.snippet, message.from, message.to, message.cc]
            .filter(Boolean)
            .join("\n"),
          provider: "outlook",
          sourceObjectId: message.id,
          metadata: {
            provider: "outlook",
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
              title: message.subject?.trim() || "Email update synced from Outlook",
              description: message.snippet || null,
              occurred_at: occurredAt,
              metadata: {
                topic: "outlook_email",
                integration_source: "outlook",
                outlook_message_id: message.id,
                outlook_thread_id: message.threadId,
                from: message.from,
                to: message.to,
                cc: message.cc,
              },
            })
            .select("*")
            .single();

          if (activityInsert.error || !activityInsert.data) {
            throw activityInsert.error ?? new Error("Failed to insert Outlook activity.");
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
            provider: "outlook",
            sourceObjectId: activityInsert.data.id,
            metadata: {
              provider: "outlook",
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
                title: message.subject?.trim() || "Outlook email summary",
                content: noteContent,
                source_type: "email_summary",
                topic: "outlook_email",
                importance_level: "medium",
              })
              .select("*")
              .single();

            if (noteInsert.error || !noteInsert.data) {
              throw noteInsert.error ?? new Error("Failed to insert Outlook note.");
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
              console.error("HydraDB Outlook note ingestion failed", ingestError);
            }

            await upsertSearchIndexEntry({
              workspaceId: input.workspace.id,
              userId: input.userId,
              entityType: "note",
              entityId: insertedNote.id,
              title: insertedNote.title ?? message.subject ?? "Outlook note",
              body: insertedNote.content,
              provider: "outlook",
              sourceObjectId: insertedNote.id,
              metadata: {
                provider: "outlook",
                account_id: matchedAccount.id,
                contact_id: matchedContact?.id ?? null,
              },
            });
          }
        }

        const syncInsert = await supabase.from("outlook_message_syncs").insert({
          workspace_id: input.workspace.id,
          user_id: input.userId,
          outlook_message_id: message.id,
          outlook_thread_id: message.threadId,
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
        console.error("Outlook message sync failed", messageError);
        result.failed += 1;
      }
    }

    for (const event of events) {
      try {
        const attendeePersonIds: string[] = [];
        let matchedAccount: Account | null = null;

        for (const email of event.attendeeEmails.slice(0, 8)) {
          let contact = contactByEmail.get(email) ?? null;
          if (!matchedAccount) {
            matchedAccount =
              typedAccounts.find((account) => {
                const domain = extractDomain(email);
                return domain ? normalizeDomain(account.domain) === domain : false;
              }) ?? null;
          }

          if (!matchedAccount) {
            matchedAccount = await ensureAccountForEmail({
              workspaceId: input.workspace.id,
              userId: input.userId,
              email,
              provider: "outlook",
            });
            if (matchedAccount) {
              typedAccounts.push(matchedAccount);
              if (matchedAccount.domain) {
                accountByDomain.set(normalizeDomain(matchedAccount.domain)!, matchedAccount);
              }
            }
          }

          if (matchedAccount && !contact) {
            contact = await ensureContactForEmail({
              workspaceId: input.workspace.id,
              accountId: matchedAccount.id,
              email,
            });
            if (contact.email) {
              typedContacts.push(contact);
              contactByEmail.set(contact.email.toLowerCase(), contact);
            }
          }

          if (!matchedAccount || !contact) continue;

          const organization = await ensureOrganizationForAccount({
            workspaceId: input.workspace.id,
            userId: input.userId,
            account: matchedAccount,
            provider: "outlook",
          });
          const person = await ensurePersonProjection({
            workspaceId: input.workspace.id,
            userId: input.userId,
            provider: "outlook",
            organizationId: organization.id,
            contact,
            sourceObjectId: contact.id,
          });
          attendeePersonIds.push(person.id);
        }

        const organization = matchedAccount
          ? await ensureOrganizationForAccount({
              workspaceId: input.workspace.id,
              userId: input.userId,
              account: matchedAccount,
              provider: "outlook",
            })
          : null;

        const meeting = await upsertMeetingProjection({
          workspaceId: input.workspace.id,
          userId: input.userId,
          provider: "outlook",
          organizationId: organization?.id ?? null,
          topic: event.subject,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          attendeePersonIds,
          status: event.status,
          sourceObjectId: event.id,
          normalizedPayload: {
            provider: "outlook",
            attendee_display: event.attendeeDisplay,
            web_link: event.webLink,
          },
        });

        await upsertSearchIndexEntry({
          workspaceId: input.workspace.id,
          userId: input.userId,
          entityType: "meeting",
          entityId: meeting.id,
          title: event.subject,
          body: [event.subject, ...event.attendeeDisplay].filter(Boolean).join("\n"),
          provider: "outlook",
          sourceObjectId: event.id,
          metadata: {
            provider: "outlook",
            organization_id: organization?.id ?? null,
          },
        });

        result.meetings_imported += 1;
      } catch (eventError) {
        console.error("Outlook meeting projection failed", eventError);
      }
    }

    await updateOutlookSyncState({
      workspaceId: input.workspace.id,
      userId: input.userId,
      syncStatus: "ok",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    });

    logIntegrationEvent({
      source: "outlook",
      event: "outlook_sync_completed",
      workspaceId: input.workspace.id,
      userId: input.userId,
      detail: result as unknown as Record<string, unknown>,
    });

    return result;
  } catch (error) {
    await updateOutlookSyncState({
      workspaceId: input.workspace.id,
      userId: input.userId,
      syncStatus: "error",
      lastError: error instanceof Error ? error.message : "Outlook sync failed.",
    });

    throw error;
  }
}
