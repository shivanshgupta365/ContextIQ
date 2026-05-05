import "dotenv/config";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const appBaseUrl = process.env.APP_BASE_URL?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

function requireEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function fetchWithStatus(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    redirect: "manual",
    ...init,
  });

  return {
    status: response.status,
    location: response.headers.get("location"),
    body: await response.text(),
  };
}

async function verifyPublicRoute(baseUrl: string, path: string, acceptedStatuses: number[]) {
  const result = await fetchWithStatus(new URL(path, baseUrl).toString());
  const ok = acceptedStatuses.includes(result.status);
  return {
    name: `Route ${path}`,
    ok,
    detail: ok
      ? `HTTP ${result.status}`
      : `Expected ${acceptedStatuses.join("/")} but got HTTP ${result.status}${result.location ? ` -> ${result.location}` : ""}`,
  } satisfies CheckResult;
}

async function verifySupabaseTable(
  baseUrl: string,
  key: string,
  table: string,
  select: string,
) {
  const url = `${baseUrl.replace(/\/$/, "")}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`;
  const result = await fetchWithStatus(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  const ok = result.status >= 200 && result.status < 300;
  return {
    name: `Supabase ${table}`,
    ok,
    detail: ok ? `HTTP ${result.status}` : `HTTP ${result.status}: ${result.body.slice(0, 220)}`,
  } satisfies CheckResult;
}

async function main() {
  const baseUrl = requireEnv("APP_BASE_URL", appBaseUrl);
  const restBase = requireEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  const roleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);

  const checks: CheckResult[] = [];

  checks.push(await verifyPublicRoute(baseUrl, "/", [200]));
  checks.push(await verifyPublicRoute(baseUrl, "/auth/sign-in", [200]));
  checks.push(await verifyPublicRoute(baseUrl, "/overview", [200, 307, 308]));
  checks.push(await verifyPublicRoute(baseUrl, "/command-center?q=test", [200, 307, 308]));

  checks.push(await verifySupabaseTable(restBase, roleKey, "profiles", "id"));
  checks.push(await verifySupabaseTable(restBase, roleKey, "workspace_members", "id"));
  checks.push(await verifySupabaseTable(restBase, roleKey, "slack_integrations", "needs_reconnect"));
  checks.push(await verifySupabaseTable(restBase, roleKey, "workspace_context_pins", "id"));

  const failed = checks.filter((check) => !check.ok);

  console.log("ContextIQ rollout verification\n");
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
    console.log(`      ${check.detail}`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} verification check(s) failed.`);
    process.exit(1);
  }

  console.log("\nAll rollout verification checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
