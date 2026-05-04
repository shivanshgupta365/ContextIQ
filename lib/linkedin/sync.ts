import { addMemories, buildNoteMemoryPayload } from "@/lib/hydradb/client";
import {
  buildLinkedInContentHash,
  fetchLinkedInOEmbed,
  fetchLinkedInUserInfo,
} from "@/lib/linkedin/client";
import {
  getDecryptedLinkedInIntegration,
  updateLinkedInSyncState,
} from "@/lib/linkedin/integration-store";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { logIntegrationEvent } from "@/lib/integrations/telemetry";
import {
  ensureIdentityAlias,
  ensureOrganizationForAccount,
  ensurePersonProjection,
  upsertSearchIndexEntry,
} from "@/lib/workspace/projections";
import type {
  Account,
  Contact,
  LinkedInSyncResult,
  Note,
  Workspace,
} from "@/types";

export async function syncWorkspaceLinkedInSignals(input: {
  userId: string;
  workspace: Workspace;
  maxContacts?: number;
}): Promise<LinkedInSyncResult> {
  const supabase = getSupabaseAdminClient();
  const maxContacts = Math.min(Math.max(input.maxContacts ?? 20, 1), 50);

  const integration = await getDecryptedLinkedInIntegration({
    workspaceId: input.workspace.id,
    userId: input.userId,
  });

  if (!integration) {
    throw new Error("LinkedIn is not connected. Connect LinkedIn first.");
  }

  await updateLinkedInSyncState({
    workspaceId: input.workspace.id,
    userId: input.userId,
    syncStatus: "syncing",
    lastError: null,
  });

  try {
    const userInfo = await fetchLinkedInUserInfo({
      accessToken: integration.access_token,
    });

    if (userInfo.email && integration.email !== userInfo.email) {
      await supabase
        .from("linkedin_integrations")
        .update({
          email: userInfo.email,
          linkedin_sub: userInfo.sub,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", input.workspace.id)
        .eq("user_id", input.userId)
        .eq("provider", "linkedin");
    }

    const [{ data: contacts }, { data: accounts }] = await Promise.all([
      supabase
        .from("contacts")
        .select("*")
        .eq("workspace_id", input.workspace.id)
        .not("linkedin_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(maxContacts),
      supabase
        .from("accounts")
        .select("*")
        .eq("workspace_id", input.workspace.id),
    ]);

    const typedContacts = (contacts ?? []) as Contact[];
    const accountMap = new Map(
      ((accounts ?? []) as Account[]).map((account) => [account.id, account]),
    );

    const result: LinkedInSyncResult = {
      scanned: typedContacts.length,
      imported: 0,
      skipped: 0,
      failed: 0,
    };
    logIntegrationEvent({
      source: "linkedin",
      event: "sync_started",
      workspaceId: input.workspace.id,
      userId: input.userId,
      detail: { scanned_candidates: typedContacts.length },
    });

    for (const contact of typedContacts) {
      if (!contact.linkedin_url) {
        result.skipped += 1;
        continue;
      }

      const account = accountMap.get(contact.account_id);
      if (!account) {
        result.skipped += 1;
        continue;
      }

      try {
        const oembed = await fetchLinkedInOEmbed({
          url: contact.linkedin_url,
        });
        const organization = await ensureOrganizationForAccount({
          workspaceId: input.workspace.id,
          userId: input.userId,
          account,
          provider: "linkedin",
        });
        const person = await ensurePersonProjection({
          workspaceId: input.workspace.id,
          userId: input.userId,
          provider: "linkedin",
          organizationId: organization.id,
          contact,
          sourceObjectId: contact.id,
        });

        if (contact.email) {
          await ensureIdentityAlias({
            workspaceId: input.workspace.id,
            userId: input.userId,
            personId: person.id,
            provider: "linkedin",
            aliasType: "email",
            aliasValue: contact.email,
            sourceProvider: "linkedin",
            sourceObjectId: contact.id,
          });
        }
        if (contact.linkedin_url) {
          await ensureIdentityAlias({
            workspaceId: input.workspace.id,
            userId: input.userId,
            personId: person.id,
            provider: "linkedin",
            aliasType: "linkedin_url",
            aliasValue: contact.linkedin_url,
            sourceProvider: "linkedin",
            sourceObjectId: contact.id,
          });
        }

        const summaryLines = [
          `LinkedIn URL: ${contact.linkedin_url}`,
          oembed.title ? `Title: ${oembed.title}` : null,
          oembed.authorName ? `Author: ${oembed.authorName}` : null,
          oembed.authorUrl ? `Author URL: ${oembed.authorUrl}` : null,
          oembed.providerName ? `Provider: ${oembed.providerName}` : null,
          userInfo.name ? `Synced by: ${userInfo.name}` : null,
        ].filter(Boolean) as string[];

        const content = summaryLines.join("\n");
        const contentHash = buildLinkedInContentHash({
          url: contact.linkedin_url,
          content,
        });

        const { data: existingSync } = await supabase
          .from("linkedin_profile_syncs")
          .select("id")
          .eq("workspace_id", input.workspace.id)
          .eq("contact_id", contact.id)
          .eq("content_hash", contentHash)
          .maybeSingle();

        if (existingSync) {
          result.skipped += 1;
          continue;
        }

        const noteInsert = await supabase
          .from("notes")
          .insert({
            workspace_id: input.workspace.id,
            account_id: account.id,
            contact_id: contact.id,
            author_id: input.userId,
            title: `LinkedIn sync: ${contact.name}`,
            content,
            source_type: "crm_import",
            topic: "linkedin_profile_signal",
            importance_level: "medium",
          })
          .select("*")
          .single();

        if (noteInsert.error || !noteInsert.data) {
          throw noteInsert.error ?? new Error("Failed to insert LinkedIn note.");
        }

        const insertedNote = noteInsert.data as Note;

        const activityInsert = await supabase
          .from("activities")
          .insert({
            workspace_id: input.workspace.id,
            account_id: account.id,
            contact_id: contact.id,
            actor_id: input.userId,
            activity_type: "note_added",
            title: `LinkedIn context synced for ${contact.name}`,
            description: oembed.title ?? "LinkedIn profile signal synced.",
            metadata: {
              topic: "linkedin_profile_signal",
              linkedin_url: contact.linkedin_url,
              linkedin_author_name: oembed.authorName,
              linkedin_author_url: oembed.authorUrl,
              linkedin_provider: oembed.providerName,
            },
            occurred_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (activityInsert.error || !activityInsert.data) {
          throw activityInsert.error ?? new Error("Failed to insert LinkedIn activity.");
        }

        try {
          const hydraResponse = await addMemories({
            tenantId: input.workspace.hydradb_tenant_id,
            memories: [
              buildNoteMemoryPayload({
                note: insertedNote,
                account,
                contact,
                userId: input.userId,
              }),
            ],
          });

          const memoryId = hydraResponse.memory_ids?.[0] ?? hydraResponse.ids?.[0] ?? null;
          if (memoryId) {
            await supabase
              .from("notes")
              .update({ hydradb_memory_id: memoryId })
              .eq("id", insertedNote.id);
          }
        } catch (ingestError) {
          console.error("HydraDB LinkedIn note ingestion failed", ingestError);
        }

        await upsertSearchIndexEntry({
          workspaceId: input.workspace.id,
          userId: input.userId,
          entityType: "person",
          entityId: person.id,
          title: person.full_name,
          body: [contact.email, contact.title, content].filter(Boolean).join("\n"),
          provider: "linkedin",
          sourceObjectId: contact.id,
          metadata: {
            provider: "linkedin",
            organization_id: organization.id,
            contact_id: contact.id,
          },
        });

        await upsertSearchIndexEntry({
          workspaceId: input.workspace.id,
          userId: input.userId,
          entityType: "note",
          entityId: insertedNote.id,
          title: insertedNote.title,
          body: insertedNote.content,
          provider: "linkedin",
          sourceObjectId: insertedNote.id,
          metadata: {
            provider: "linkedin",
            account_id: account.id,
            contact_id: contact.id,
          },
        });

        const syncInsert = await supabase.from("linkedin_profile_syncs").insert({
          workspace_id: input.workspace.id,
          user_id: input.userId,
          account_id: account.id,
          contact_id: contact.id,
          source_url: contact.linkedin_url,
          content_hash: contentHash,
          note_id: insertedNote.id,
          activity_id: activityInsert.data.id,
        });

        if (syncInsert.error) throw syncInsert.error;

        result.imported += 1;
      } catch (contactError) {
        console.error("LinkedIn contact sync failed", contactError);
        result.failed += 1;
      }
    }

    await updateLinkedInSyncState({
      workspaceId: input.workspace.id,
      userId: input.userId,
      syncStatus: "ok",
      lastError: null,
      lastSyncedAt: new Date().toISOString(),
    });
    logIntegrationEvent({
      source: "linkedin",
      event: "sync_completed",
      workspaceId: input.workspace.id,
      userId: input.userId,
      detail: {
        scanned: result.scanned,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    return result;
  } catch (error) {
    await updateLinkedInSyncState({
      workspaceId: input.workspace.id,
      userId: input.userId,
      syncStatus: "error",
      lastError: error instanceof Error ? error.message : "LinkedIn sync failed.",
    });
    logIntegrationEvent({
      source: "linkedin",
      event: "sync_failed",
      workspaceId: input.workspace.id,
      userId: input.userId,
      detail: {
        message: error instanceof Error ? error.message : "LinkedIn sync failed.",
      },
    });
    throw error;
  }
}
