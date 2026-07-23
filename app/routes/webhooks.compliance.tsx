import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendDataRequestExport, type DataRequestRecord } from "../email.server";

// Mandatory compliance webhooks. Reviewers verify these actually do something.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);
  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });

  switch (topic) {
    case "CUSTOMERS_REDACT": {
      // Delete every waitlist row for this customer's email.
      const email = (payload as any)?.customer?.email;
      if (shopRow && email) {
        await prisma.subscriber.deleteMany({ where: { shopId: shopRow.id, email } });
      }
      break;
    }

    case "SHOP_REDACT": {
      // Fired 48h after uninstall — erase all of the shop's data.
      if (shopRow) {
        await prisma.shop.delete({ where: { id: shopRow.id } }); // cascades to subscribers + alerts
      }
      break;
    }

    case "CUSTOMERS_DATA_REQUEST": {
      const email = (payload as any)?.customer?.email;
      // Fulfil out-of-band: return 200 promptly, and never let a slow API/email
      // call delay the response or throw into the webhook.
      fulfilDataRequest(shop, shopRow, admin, email).catch((err) =>
        console.error("[gdpr] data_request fulfilment failed:", err),
      );
      break;
    }
  }

  return new Response(null, { status: 200 });
};

// Emails the merchant everything Restock Alerts stores for a shopper. Prefers the
// store's contact email (Admin API), falls back to the configured reply-to; if neither
// is available it logs the records rather than throwing.
async function fulfilDataRequest(
  shop: string,
  shopRow: { id: string; replyTo: string | null } | null,
  admin: { graphql: (query: string) => Promise<Response> } | undefined,
  customerEmail: string | undefined,
) {
  const records: DataRequestRecord[] =
    shopRow && customerEmail
      ? await prisma.subscriber.findMany({
          where: { shopId: shopRow.id, email: customerEmail },
          select: { productTitle: true, variantTitle: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : [];

  let merchantEmail: string | null = null;
  if (admin) {
    try {
      const res = await admin.graphql(`#graphql
        query { shop { email } }`);
      merchantEmail = (await res.json())?.data?.shop?.email ?? null;
    } catch (err) {
      console.error("[gdpr] shop email lookup failed:", err);
    }
  }
  if (!merchantEmail) merchantEmail = shopRow?.replyTo ?? null;

  if (!merchantEmail) {
    console.warn(
      `[gdpr] data_request ${shop} ${customerEmail}: no merchant email; ${records.length} record(s) not delivered`,
      records,
    );
    return;
  }

  await sendDataRequestExport(merchantEmail, shop, customerEmail ?? "(unknown)", records);
  console.log(
    `[gdpr] data_request ${shop}: emailed ${records.length} record(s) for ${customerEmail} to ${merchantEmail}`,
  );
}
