import { redirect } from "next/navigation";

import { AuthPage } from "@/components/contextiq/auth-page";
import { getSessionUser } from "@/lib/auth/session";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; next?: string }>;
}) {
  const params = await searchParams;
  const intent =
    params.intent === "gmail_connect"
      ? "gmail_connect"
      : params.intent === "outlook_connect"
        ? "outlook_connect"
        : "sign_in";
  const returnTo = params.next?.startsWith("/") ? params.next : "/overview";
  const user = await getSessionUser();

  if (intent === "gmail_connect") {
    redirect((`/auth/gmail/start?next=${encodeURIComponent(returnTo)}`) as any);
  }

  if (intent === "outlook_connect") {
    redirect((`/auth/outlook/start?next=${encodeURIComponent(returnTo)}`) as any);
  }

  if (user) {
    redirect("/overview");
  }

  return <AuthPage intent={intent} returnTo={returnTo} />;
}
