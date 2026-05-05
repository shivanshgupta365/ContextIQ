import type { IntegrationCapability, IntegrationProvider } from "@/types";

type UserFacingIntegrationProvider = Exclude<IntegrationProvider, "manual">;

const readWrite = (
  read = true,
  write = true,
  webhook = false,
): IntegrationCapability[] => [
  { key: "search", supported: read },
  { key: "read", supported: read },
  { key: "sync", supported: read },
  { key: "draft", supported: write },
  { key: "send", supported: write },
  { key: "writeback", supported: write },
  { key: "webhook_ingest", supported: webhook },
];

export const INTEGRATION_PROVIDERS: UserFacingIntegrationProvider[] = [
  "gmail",
  "outlook",
  "slack",
  "twilio",
  "linkedin",
  "zoom",
  "hubspot",
  "salesforce",
  "intercom",
  "notion",
  "resend",
];

export const INTEGRATION_DEFAULT_CAPABILITIES: Record<
  IntegrationProvider,
  IntegrationCapability[]
> = {
  gmail: readWrite(true, true),
  outlook: readWrite(true, true),
  slack: readWrite(true, true),
  twilio: readWrite(true, true),
  linkedin: readWrite(true, false),
  google_calendar: readWrite(false, false),
  zoom: readWrite(true, true),
  hubspot: readWrite(true, true),
  salesforce: readWrite(true, true),
  intercom: readWrite(true, true),
  notion: readWrite(true, true),
  resend: readWrite(true, true),
  manual: readWrite(false, false),
};

export function providerDisplayName(provider: IntegrationProvider) {
  const labels: Record<IntegrationProvider, string> = {
    gmail: "Gmail",
    outlook: "Outlook / Microsoft 365",
    slack: "Slack",
    twilio: "Twilio SMS/WhatsApp",
    linkedin: "LinkedIn",
    google_calendar: "Google Calendar",
    zoom: "Zoom",
    hubspot: "HubSpot",
    salesforce: "Salesforce",
    intercom: "Intercom",
    notion: "Notion",
    resend: "Resend",
    manual: "Manual upload",
  };

  return labels[provider];
}
