import type { ActivityRecord, Note, RecalledMemoryMetadata } from "@/types";

function normalizedValue(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

export function inferIntegrationSource(input: {
  topic?: string | null;
  sourceType?: string | null;
  explicitProvider?: string | null;
}) {
  const explicit = normalizedValue(input.explicitProvider);
  if (explicit.includes("gmail")) return "gmail";
  if (explicit.includes("outlook") || explicit.includes("microsoft")) return "outlook";
  if (explicit.includes("linkedin")) return "linkedin";
  if (explicit.includes("slack")) return "slack";

  const topic = normalizedValue(input.topic);
  if (topic.includes("gmail")) return "gmail";
  if (topic.includes("outlook") || topic.includes("microsoft")) return "outlook";
  if (topic.includes("linkedin")) return "linkedin";
  if (topic.includes("slack")) return "slack";

  const sourceType = normalizedValue(input.sourceType);
  if (sourceType.includes("gmail")) return "gmail";
  if (sourceType.includes("outlook") || sourceType.includes("microsoft")) return "outlook";
  if (sourceType.includes("linkedin")) return "linkedin";
  if (sourceType.includes("slack")) return "slack";

  return null;
}

export function inferIntegrationSourceForNote(note: Pick<Note, "source_type" | "topic">) {
  return inferIntegrationSource({
    topic: note.topic,
    sourceType: note.source_type,
  });
}

export function inferIntegrationSourceForActivity(
  activity: Pick<ActivityRecord, "activity_type" | "metadata">,
) {
  const topic =
    typeof activity.metadata?.topic === "string"
      ? activity.metadata.topic
      : activity.activity_type;

  return inferIntegrationSource({
    topic,
    sourceType: activity.activity_type,
    explicitProvider:
      typeof activity.metadata?.integration_source === "string"
        ? activity.metadata.integration_source
        : null,
  });
}

export function inferIntegrationSourceForMemory(metadata: Partial<RecalledMemoryMetadata>) {
  return inferIntegrationSource({
    topic: metadata.topic ?? null,
    sourceType: metadata.source_type ?? null,
    explicitProvider: metadata.integration_source ?? null,
  });
}
