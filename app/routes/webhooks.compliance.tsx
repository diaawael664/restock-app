import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Mandatory compliance webhooks. Reviewers verify these actually do something.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
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
      // We hold only: email + which variants they subscribed to. Log the request;
      // fulfil the export out of band (email the merchant the rows for this customer).
      const email = (payload as any)?.customer?.email;
      const rows = shopRow && email
        ? await prisma.subscriber.findMany({
            where: { shopId: shopRow.id, email },
            select: { email: true, productTitle: true, variantTitle: true, createdAt: true },
          })
        : [];
      console.log(`[gdpr] data_request ${shop} ${email}: ${rows.length} record(s)`, rows);
      break;
    }
  }

  return new Response(null, { status: 200 });
};
