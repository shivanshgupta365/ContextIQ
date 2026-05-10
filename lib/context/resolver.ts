import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { PersonResolverMatch, PersonResolverResult } from "@/types";

type PersonRow = {
  id: string;
  full_name: string;
  email: string | null;
  title: string | null;
  contact_id: string | null;
  organization_id: string | null;
  source_provider: string;
};

type AliasRow = {
  person_id: string;
  alias_value: string;
  provider: string;
  alias_type: string;
};

type SourceRow = {
  person_id: string;
  source_provider: string;
  source_user_id: string | null;
  source_email: string | null;
  source_display_name: string | null;
};

type ContactRow = {
  id: string;
  account_id: string;
  name: string;
  email: string | null;
  title: string | null;
  linkedin_url: string | null;
};

type OrganizationRow = {
  id: string;
  account_id: string | null;
  name: string;
  domain: string | null;
};

function normalize(input: string) {
  return input.trim().toLowerCase();
}

function tokenize(input: string) {
  return normalize(input)
    .replace(/[^a-z0-9@._-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function clampScore(value: number) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}

export async function resolvePersonIdentity(input: {
  workspaceId: string;
  personId?: string | null;
  query?: string | null;
  accountId?: string | null;
  limit?: number;
}): Promise<PersonResolverResult> {
  const supabase = await getSupabaseServerClient();
  const limit = Math.max(1, Math.min(input.limit ?? 5, 12));

  if (input.personId) {
    const { data, error } = await supabase
      .from("people")
      .select("id,full_name,email")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.personId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return {
        person_id: null,
        confidence: 0,
        matches: [],
        explain: ["person_id_not_found"],
      };
    }

    return {
      person_id: String(data.id),
      confidence: 1,
      matches: [
        {
          person_id: String(data.id),
          display_name: String(data.full_name ?? "Unknown person"),
          email: (data.email as string | null) ?? null,
          confidence: 1,
          sources: [],
        },
      ],
      explain: ["direct_person_id_match"],
    };
  }

  const rawQuery = (input.query ?? "").trim();
  if (!rawQuery) {
    return {
      person_id: null,
      confidence: 0,
      matches: [],
      explain: ["empty_query"],
    };
  }

  const queryTokens = tokenize(rawQuery);
  const normalizedQuery = normalize(rawQuery);

  const [peopleResult, aliasesResult, sourcesResult, contactsResult, organizationsResult] = await Promise.all([
    supabase
      .from("people")
      .select("id,full_name,email,title,contact_id,organization_id,source_provider")
      .eq("workspace_id", input.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase
      .from("identity_aliases")
      .select("person_id,alias_value,provider,alias_type")
      .eq("workspace_id", input.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("person_sources")
      .select("person_id,source_provider,source_user_id,source_email,source_display_name")
      .eq("workspace_id", input.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("contacts")
      .select("id,account_id,name,email,title,linkedin_url")
      .eq("workspace_id", input.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase
      .from("organizations")
      .select("id,account_id,name,domain")
      .eq("workspace_id", input.workspaceId)
      .limit(200),
  ]);

  if (peopleResult.error) throw peopleResult.error;
  if (aliasesResult.error) throw aliasesResult.error;
  if (sourcesResult.error && sourcesResult.error.code !== "42P01") throw sourcesResult.error;
  if (contactsResult.error) throw contactsResult.error;
  if (organizationsResult.error) throw organizationsResult.error;

  const people = (peopleResult.data ?? []) as PersonRow[];
  const aliases = (aliasesResult.data ?? []) as AliasRow[];
  const sources = (sourcesResult.data ?? []) as SourceRow[];
  const contacts = (contactsResult.data ?? []) as ContactRow[];
  const organizations = (organizationsResult.data ?? []) as OrganizationRow[];

  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const organizationById = new Map(organizations.map((org) => [org.id, org]));

  const aliasesByPerson = new Map<string, AliasRow[]>();
  for (const alias of aliases) {
    const current = aliasesByPerson.get(alias.person_id) ?? [];
    current.push(alias);
    aliasesByPerson.set(alias.person_id, current);
  }

  const sourcesByPerson = new Map<string, SourceRow[]>();
  for (const source of sources) {
    const current = sourcesByPerson.get(source.person_id) ?? [];
    current.push(source);
    sourcesByPerson.set(source.person_id, current);
  }

  const matches: PersonResolverMatch[] = [];
  const explain: string[] = [];

  for (const person of people) {
    const personAliases = aliasesByPerson.get(person.id) ?? [];
    const personSources = sourcesByPerson.get(person.id) ?? [];
    const linkedContact = person.contact_id ? contactById.get(person.contact_id) ?? null : null;
    const org = person.organization_id ? organizationById.get(person.organization_id) : null;

    const matchBlob = [
      person.full_name,
      person.email,
      person.title,
      org?.name,
      org?.domain,
      linkedContact?.name,
      linkedContact?.email,
      linkedContact?.linkedin_url,
      ...personAliases.map((alias) => alias.alias_value),
      ...personSources.flatMap((source) => [
        source.source_user_id,
        source.source_email,
        source.source_display_name,
      ]),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();

    let score = 0;
    const localExplain: string[] = [];

    if (person.email && normalize(person.email) === normalizedQuery) {
      score += 1.2;
      localExplain.push("exact_email_match");
    }

    if (normalize(person.full_name) === normalizedQuery) {
      score += 1;
      localExplain.push("exact_name_match");
    }

    for (const alias of personAliases) {
      const aliasValue = normalize(alias.alias_value);
      if (aliasValue === normalizedQuery) {
        score += 1;
        localExplain.push(`exact_alias:${alias.alias_type}`);
      } else if (aliasValue.includes(normalizedQuery)) {
        score += 0.45;
        localExplain.push(`partial_alias:${alias.alias_type}`);
      }
    }

    if (matchBlob.includes(normalizedQuery)) {
      score += 0.35;
      localExplain.push("query_blob_match");
    }

    for (const token of queryTokens) {
      if (token.length < 2) continue;
      if (matchBlob.includes(token)) score += 0.1;
    }

    if (input.accountId) {
      const personAccountId = org?.account_id ?? linkedContact?.account_id ?? null;
      if (personAccountId && personAccountId === input.accountId) {
        score += 0.25;
        localExplain.push("account_scope_boost");
      }
    }

    if (score <= 0.3) continue;

    const sourceNames = new Set<string>();
    for (const alias of personAliases) sourceNames.add(alias.provider);
    for (const source of personSources) sourceNames.add(source.source_provider);
    if (person.source_provider) sourceNames.add(person.source_provider);

    const confidence = clampScore(score / 2.1);

    matches.push({
      person_id: person.id,
      display_name: person.full_name,
      email: person.email,
      confidence,
      sources: [...sourceNames].filter(Boolean).slice(0, 6),
    });
    explain.push(...localExplain.map((entry) => `${person.id}:${entry}`));
  }

  const sorted = matches.sort((a, b) => b.confidence - a.confidence).slice(0, limit);

  if (sorted.length === 0) {
    return {
      person_id: null,
      confidence: 0,
      matches: [],
      explain: ["no_match_found"],
    };
  }

  const winner = sorted[0];
  const runner = sorted[1];
  const ambiguous = runner ? Math.abs(winner.confidence - runner.confidence) < 0.12 : false;

  return {
    person_id: ambiguous ? null : winner.person_id,
    confidence: ambiguous ? winner.confidence : Math.max(winner.confidence, 0.55),
    matches: sorted,
    explain,
  };
}
