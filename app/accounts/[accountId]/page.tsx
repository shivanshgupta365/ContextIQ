import { notFound } from "next/navigation";

import { AccountPageClient } from "@/components/contextiq/account-page-client";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getAccountPageData,
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
} from "@/lib/data/contextiq";

export default async function AccountRoute({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const accountResult = await getAccountPageData(accountId).catch(() => null);
  if (!accountResult) {
    notFound();
  }

  const [{ workspace, profile }, accounts, integrationStatuses] = await Promise.all([
    getWorkspaceContext(),
    getWorkspaceAccounts(),
    getWorkspaceIntegrationStatuses(),
  ]);

  return (
    <WorkspaceShell
      activeView="accounts"
      headerLabel={accountResult.account.name}
      accounts={accounts}
      profileName={profile.full_name || profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      activeAccountId={accountId}
    >
      <AccountPageClient
        workspaceId={workspace.id}
        allAccounts={accounts}
        initialData={accountResult}
      />
    </WorkspaceShell>
  );
}
