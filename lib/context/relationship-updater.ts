import type { IntegrationProvider } from "@/types";
import {
  upsertPersonSource,
  upsertPersonThreadLink,
  upsertRelationshipEdge,
  upsertRelationshipMemory,
} from "@/lib/workspace/projections";

function inferTopics(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 5)
    .filter((token, index, array) => array.indexOf(token) === index)
    .slice(0, 6);
}

export async function upsertPersonRelationshipContext(input: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  personId: string;
  personEmail?: string | null;
  personName?: string | null;
  sourceObjectId: string;
  sourceUserId?: string | null;
  sourceProfileUrl?: string | null;
  conversationId?: string | null;
  accountId?: string | null;
  interactionAt?: string | null;
  content: string;
  role?: string;
  pendingActions?: string[];
  sourceRefs?: Array<Record<string, unknown>>;
}) {
  const interactionAt = input.interactionAt ?? new Date().toISOString();

  await upsertPersonSource({
    workspaceId: input.workspaceId,
    userId: input.userId,
    personId: input.personId,
    sourceProvider: input.provider,
    sourceObjectId: input.sourceObjectId,
    sourceUserId: input.sourceUserId ?? null,
    sourceProfileUrl: input.sourceProfileUrl ?? null,
    sourceEmail: input.personEmail ?? null,
    sourceDisplayName: input.personName ?? null,
    lastSeenAt: interactionAt,
    normalizedPayload: {
      person_id: input.personId,
      provider: input.provider,
      source_object_id: input.sourceObjectId,
    },
  });

  if (input.conversationId) {
    await upsertPersonThreadLink({
      workspaceId: input.workspaceId,
      userId: input.userId,
      personId: input.personId,
      conversationId: input.conversationId,
      provider: input.provider,
      sourceObjectId: input.sourceObjectId,
      role: input.role ?? "participant",
      lastSeenAt: interactionAt,
      normalizedPayload: {
        provider: input.provider,
        source_object_id: input.sourceObjectId,
      },
    });

    await upsertRelationshipEdge({
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.provider,
      sourceObjectId: input.sourceObjectId,
      fromEntityType: "person",
      fromEntityId: input.personId,
      edgeType: "mentioned_in",
      toEntityType: "conversation",
      toEntityId: input.conversationId,
      weight: 0.9,
      sourceRefs: input.sourceRefs ?? [],
      normalizedPayload: {
        provider: input.provider,
      },
      lastSeenAt: interactionAt,
    });
  }

  if (input.accountId) {
    await upsertRelationshipEdge({
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.provider,
      sourceObjectId: input.sourceObjectId,
      fromEntityType: "person",
      fromEntityId: input.personId,
      edgeType: "related_to_account",
      toEntityType: "organization",
      toEntityId: input.accountId,
      weight: 0.8,
      sourceRefs: input.sourceRefs ?? [],
      normalizedPayload: {
        provider: input.provider,
      },
      lastSeenAt: interactionAt,
    });
  }

  const summary =
    input.personName != null && input.personName.trim().length > 0
      ? `${input.personName} was referenced in ${input.provider} context: ${input.content.slice(0, 220)}`
      : `Person context detected from ${input.provider}: ${input.content.slice(0, 220)}`;

  await upsertRelationshipMemory({
    workspaceId: input.workspaceId,
    userId: input.userId,
    personId: input.personId,
    provider: input.provider,
    sourceObjectId: input.sourceObjectId,
    summary,
    relationshipType: "contact",
    status: "active",
    sentiment: "neutral",
    lastInteractionAt: interactionAt,
    topics: inferTopics(input.content),
    pendingActions: input.pendingActions ?? [],
    sourceRefs: input.sourceRefs ?? [],
    normalizedPayload: {
      provider: input.provider,
      source_object_id: input.sourceObjectId,
    },
  });
}
