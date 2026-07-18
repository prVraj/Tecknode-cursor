/**
 * Single source of truth for Composio OAuth "personal data layer" integrations.
 *
 * Each entry is a provider connected through Composio managed OAuth (the same
 * flow as Stripe/Gumroad). The auth config id is NOT pinned per-provider in env
 * — it is resolved at runtime from the Composio API by `toolkit` slug (see
 * resolveAuthConfigId in @/lib/composio), so the operator only creates the auth
 * config in the Composio dashboard; no env copying. We persist the Composio
 * `connectedAccountId` per org (`column`); tokens live in Composio. This module
 * is pure metadata — safe to import in client components.
 *
 * Data fetch + signal extraction per provider is intentionally NOT wired here
 * yet; this is the connection plumbing only.
 */

export type OAuthProviderMeta = {
  /** Stable provider key — DB column prefix, zod enum value and UI key. */
  key: string;
  /** Display name. */
  label: string;
  /** UI section grouping. */
  category: string;
  /** One-line card description. */
  description: string;
  /** Composio toolkit slug — used to resolve the auth config id at runtime. */
  toolkit: string;
  /** `org_analytics_connections` column storing the Composio connected-account id. */
  column: string;
};

export const OAUTH_PROVIDERS = [
  {
    key: "mixpanel",
    label: "Mixpanel",
    category: "Product analytics",
    description:
      "Product analytics — events, funnels and retention from Mixpanel.",
    toolkit: "mixpanel",
    column: "mixpanelConnectedAccountId",
  },
  {
    key: "amplitude",
    label: "Amplitude",
    category: "Product analytics",
    description:
      "Product analytics — user behavior, funnels and cohorts from Amplitude.",
    toolkit: "amplitude",
    column: "amplitudeConnectedAccountId",
  },
  {
    key: "ahrefs",
    label: "Ahrefs",
    category: "SEO & search",
    description:
      "Backlinks, keyword rankings and organic visibility from Ahrefs.",
    toolkit: "ahrefs",
    column: "ahrefsConnectedAccountId",
  },
  {
    key: "semrush",
    label: "Semrush",
    category: "SEO & search",
    description:
      "Keyword, traffic and competitor visibility data from Semrush.",
    toolkit: "semrush",
    column: "semrushConnectedAccountId",
  },
  {
    key: "paypal",
    label: "PayPal",
    category: "Payments & commerce",
    description: "Track payments, payouts and revenue from PayPal.",
    toolkit: "paypal",
    column: "paypalConnectedAccountId",
  },
  {
    key: "square",
    label: "Square",
    category: "Payments & commerce",
    description: "Monitor payments, orders and revenue from Square.",
    toolkit: "square",
    column: "squareConnectedAccountId",
  },
  {
    key: "shopify",
    label: "Shopify",
    category: "Payments & commerce",
    description: "Orders, revenue and customers from your Shopify store.",
    toolkit: "shopify",
    column: "shopifyConnectedAccountId",
  },
  {
    key: "whop",
    label: "Whop",
    category: "Payments & commerce",
    description: "Memberships, sales and revenue from Whop.",
    toolkit: "whop",
    column: "whopConnectedAccountId",
  },
  {
    key: "quickbooks",
    label: "QuickBooks",
    category: "Payments & commerce",
    description: "Invoices, revenue and accounting data from QuickBooks.",
    toolkit: "quickbooks",
    column: "quickbooksConnectedAccountId",
  },
  {
    key: "xero",
    label: "Xero",
    category: "Payments & commerce",
    description: "Invoices, revenue and accounting data from Xero.",
    toolkit: "xero",
    column: "xeroConnectedAccountId",
  },
  {
    key: "googleAds",
    label: "Google Ads",
    category: "Advertising",
    description: "Ad spend, clicks and conversions from Google Ads.",
    toolkit: "googleads",
    column: "googleAdsConnectedAccountId",
  },
  {
    key: "redditAds",
    label: "Reddit Ads",
    category: "Advertising",
    description: "Campaign spend, impressions and conversions from Reddit Ads.",
    toolkit: "reddit_ads",
    column: "redditAdsConnectedAccountId",
  },
  {
    key: "mailchimp",
    label: "Mailchimp",
    category: "Email & lifecycle",
    description: "Audiences, campaigns and engagement from Mailchimp.",
    toolkit: "mailchimp",
    column: "mailchimpConnectedAccountId",
  },
  {
    key: "klaviyo",
    label: "Klaviyo",
    category: "Email & lifecycle",
    description: "Lists, flows and campaign performance from Klaviyo.",
    toolkit: "klaviyo",
    column: "klaviyoConnectedAccountId",
  },
  {
    key: "brevo",
    label: "Brevo",
    category: "Email & lifecycle",
    description: "Contacts, campaigns and engagement from Brevo.",
    toolkit: "brevo",
    column: "brevoConnectedAccountId",
  },
  {
    key: "sendgrid",
    label: "SendGrid",
    category: "Email & lifecycle",
    description: "Email delivery, opens and clicks from SendGrid.",
    toolkit: "sendgrid",
    column: "sendgridConnectedAccountId",
  },
  {
    key: "customerio",
    label: "Customer.io",
    category: "Email & lifecycle",
    description: "Messaging, campaigns and engagement from Customer.io.",
    toolkit: "customerio",
    column: "customerioConnectedAccountId",
  },
  {
    key: "resend",
    label: "Resend",
    category: "Email & lifecycle",
    description: "Transactional email delivery and engagement from Resend.",
    toolkit: "resend",
    column: "resendConnectedAccountId",
  },
  {
    key: "postmark",
    label: "Postmark",
    category: "Email & lifecycle",
    description:
      "Transactional email delivery, bounces and spam from Postmark.",
    toolkit: "postmark",
    column: "postmarkConnectedAccountId",
  },
  {
    key: "hubspot",
    label: "HubSpot",
    category: "CRM",
    description: "Contacts, deals and pipeline from HubSpot.",
    toolkit: "hubspot",
    column: "hubspotConnectedAccountId",
  },
  {
    key: "salesforce",
    label: "Salesforce",
    category: "CRM",
    description: "Accounts, opportunities and pipeline from Salesforce.",
    toolkit: "salesforce",
    column: "salesforceConnectedAccountId",
  },
  {
    key: "pipedrive",
    label: "Pipedrive",
    category: "CRM",
    description: "Deals, pipeline and activities from Pipedrive.",
    toolkit: "pipedrive",
    column: "pipedriveConnectedAccountId",
  },
  {
    key: "attio",
    label: "Attio",
    category: "CRM",
    description: "Records, lists and pipeline from Attio.",
    toolkit: "attio",
    column: "attioConnectedAccountId",
  },
  {
    key: "zoho",
    label: "Zoho",
    category: "CRM",
    description: "Leads, deals and pipeline from Zoho CRM.",
    toolkit: "zoho",
    column: "zohoConnectedAccountId",
  },
  {
    key: "intercom",
    label: "Intercom",
    category: "Support & helpdesk",
    description: "Conversations, tickets and response times from Intercom.",
    toolkit: "intercom",
    column: "intercomConnectedAccountId",
  },
  {
    key: "zendesk",
    label: "Zendesk",
    category: "Support & helpdesk",
    description: "Tickets, satisfaction and response times from Zendesk.",
    toolkit: "zendesk",
    column: "zendeskConnectedAccountId",
  },
  {
    key: "freshdesk",
    label: "Freshdesk",
    category: "Support & helpdesk",
    description: "Tickets, SLAs and satisfaction from Freshdesk.",
    toolkit: "freshdesk",
    column: "freshdeskConnectedAccountId",
  },
  {
    key: "youtube",
    label: "YouTube",
    category: "Social",
    description: "Views, subscribers and engagement from YouTube.",
    toolkit: "youtube",
    column: "youtubeConnectedAccountId",
  },
  {
    key: "instagram",
    label: "Instagram",
    category: "Social",
    description: "Followers, reach and engagement from Instagram.",
    toolkit: "instagram",
    column: "instagramConnectedAccountId",
  },
  {
    key: "tiktok",
    label: "TikTok",
    category: "Social",
    description: "Views, followers and engagement from TikTok.",
    toolkit: "tiktok",
    column: "tiktokConnectedAccountId",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    category: "Social",
    description: "Page followers, impressions and engagement from LinkedIn.",
    toolkit: "linkedin",
    column: "linkedinConnectedAccountId",
  },
  {
    key: "reddit",
    label: "Reddit",
    category: "Social",
    description: "Posts, karma and community activity from Reddit.",
    toolkit: "reddit",
    column: "redditConnectedAccountId",
  },
  {
    key: "facebook",
    label: "Facebook",
    category: "Social",
    description: "Page reach, followers and engagement from Facebook.",
    toolkit: "facebook",
    column: "facebookConnectedAccountId",
  },
] as const satisfies readonly OAuthProviderMeta[];

export type OAuthProviderKey = (typeof OAUTH_PROVIDERS)[number]["key"];

/** Provider keys as a readonly tuple — feed straight into `z.enum(...)`. */
export const OAUTH_PROVIDER_KEYS = OAUTH_PROVIDERS.map((p) => p.key) as [
  OAuthProviderKey,
  ...OAuthProviderKey[],
];

/** Ordered category list (first-seen order) for rendering grouped sections. */
export const OAUTH_CATEGORIES = OAUTH_PROVIDERS.reduce<string[]>((acc, p) => {
  if (!acc.includes(p.category)) acc.push(p.category);
  return acc;
}, []);
