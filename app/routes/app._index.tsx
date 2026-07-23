import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  InlineGrid,
  EmptyState,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { refreshShopPlan, FREE_MONTHLY_CAP, PLAN_PRO } from "../billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Keep Shop.plan fresh (welcome-redirect param + Partner API); also ensures the row exists.
  const plan = await refreshShopPlan(admin, session.shop, request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const [pendingCount, totalSubscribers, alertsSentThisCycle] = await Promise.all([
    prisma.subscriber.count({ where: { shopId: shop.id, status: "pending" } }),
    prisma.subscriber.count({ where: { shopId: shop.id } }),
    prisma.alert.count({ where: { shopId: shop.id, sentAt: { gte: shop.cycleResetAt } } }),
  ]);

  const storeHandle = session.shop.replace(/\.myshopify\.com$/, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "";
  const planUrl = appHandle
    ? `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`
    : null;

  return {
    isPro: plan === PLAN_PRO,
    pendingCount,
    totalSubscribers,
    alertsSentThisCycle,
    cap: FREE_MONTHLY_CAP,
    planUrl,
    settings: {
      fromName: shop.fromName ?? "",
      replyTo: shop.replyTo ?? "",
      brandColor: shop.brandColor ?? "#111111",
      logoUrl: shop.logoUrl ?? "",
      minThreshold: shop.minThreshold,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const fromName = String(form.get("fromName") || "").trim();
  const replyTo = String(form.get("replyTo") || "").trim();
  const brandColor = String(form.get("brandColor") || "").trim() || "#111111";
  const logoUrl = String(form.get("logoUrl") || "").trim();
  const minThreshold = Math.max(1, parseInt(String(form.get("minThreshold") || "1"), 10) || 1);

  await prisma.shop.update({
    where: { shopDomain: session.shop },
    data: {
      fromName: fromName || null,
      replyTo: replyTo || null,
      brandColor,
      logoUrl: logoUrl || null,
      minThreshold,
    },
  });

  return { ok: true };
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
        <Text as="p" variant="heading2xl">{value}</Text>
        {sub ? <Text as="p" tone="subdued" variant="bodySm">{sub}</Text> : null}
      </BlockStack>
    </Card>
  );
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const saving = nav.state !== "idle" && nav.formMethod === "POST";

  const [fromName, setFromName] = useState(data.settings.fromName);
  const [replyTo, setReplyTo] = useState(data.settings.replyTo);
  const [brandColor, setBrandColor] = useState(data.settings.brandColor);
  const [logoUrl, setLogoUrl] = useState(data.settings.logoUrl);
  const [minThreshold, setMinThreshold] = useState(String(data.settings.minThreshold));

  const isPro = data.isPro;
  const hasSubscribers = data.totalSubscribers > 0;

  return (
    <Page>
      <TitleBar title="Restock Alerts" />
      <BlockStack gap="500">
        {actionData?.ok ? <Banner tone="success" title="Settings saved" /> : null}

        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Stat label="Pending subscribers" value={String(data.pendingCount)} sub="Shoppers waiting on a restock" />
          <Stat
            label="Alerts sent this month"
            value={String(data.alertsSentThisCycle)}
            sub={isPro ? "Unlimited on Pro" : `of ${data.cap} free alerts used`}
          />
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued" variant="bodySm">Plan</Text>
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="headingLg">{isPro ? "Pro" : "Free"}</Text>
                {isPro ? <Badge tone="success">Active</Badge> : null}
              </InlineStack>
              {data.planUrl ? (
                <Button url={data.planUrl} target="_top" variant={isPro ? "secondary" : "primary"}>
                  {isPro ? "Manage plan" : "Upgrade to Pro"}
                </Button>
              ) : (
                <Text as="p" tone="subdued" variant="bodySm">
                  Set SHOPIFY_APP_HANDLE to link the plan page.
                </Text>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>

        {!hasSubscribers ? (
          <Card>
            <EmptyState
              heading="No subscribers yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                When a product variant sells out, shoppers see a “Notify me” button on the
                product page and can sign up. They’ll appear here, and get emailed the moment
                you restock. Make sure the <b>Restock alerts</b> app embed is enabled in your theme.
              </p>
            </EmptyState>
          </Card>
        ) : null}

        <Layout>
          <Layout.AnnotatedSection
            title="Email branding & behavior"
            description="Controls how your confirmation and back-in-stock emails look, and when alerts fire."
          >
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <TextField
                    label="From name"
                    name="fromName"
                    value={fromName}
                    onChange={setFromName}
                    autoComplete="off"
                    helpText="Sender name on emails. Defaults to your store name if blank."
                  />
                  <TextField
                    label="Reply-to email"
                    name="replyTo"
                    type="email"
                    value={replyTo}
                    onChange={setReplyTo}
                    autoComplete="email"
                    helpText="Where replies go. Leave blank to omit a reply-to."
                  />
                  <TextField
                    label="Logo URL"
                    name="logoUrl"
                    value={logoUrl}
                    onChange={setLogoUrl}
                    autoComplete="off"
                    helpText="Shown at the top of emails. Leave blank to use your store name."
                  />
                  <TextField
                    label="Brand color"
                    name="brandColor"
                    value={brandColor}
                    onChange={setBrandColor}
                    autoComplete="off"
                    helpText="Hex color for email buttons, e.g. #111111."
                  />
                  <TextField
                    label="Restock threshold"
                    name="minThreshold"
                    type="number"
                    min={1}
                    value={minThreshold}
                    onChange={setMinThreshold}
                    autoComplete="off"
                    helpText="Only send alerts once at least this many units are back in stock."
                  />
                  <InlineStack align="end">
                    <Button submit variant="primary" loading={saving}>
                      Save settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </BlockStack>
    </Page>
  );
}
