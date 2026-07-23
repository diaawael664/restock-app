import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendConfirmationEmail } from "../email.server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
  // Verifies the App Proxy signature and gives us shop context + an admin client.
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const variantId = String(form.get("variantId") || "").trim();

  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (!variantId) {
    return Response.json({ ok: false, error: "missing_variant" }, { status: 400 });
  }

  // Ensure a Shop row exists (created lazily on first storefront interaction).
  const shopRow = await prisma.shop.upsert({
    where: { shopDomain: session.shop },
    update: {},
    create: { shopDomain: session.shop, fromName: session.shop.replace(/\.myshopify\.com$/, "") },
  });

  // Resolve variant → inventory_item_id + snapshot data in ONE GraphQL call.
  const res = await admin.graphql(
    `#graphql
    query($id: ID!) {
      productVariant(id: $id) {
        title
        price
        inventoryItem { id }
        product { id title handle featuredImage { url } }
      }
    }`,
    { variables: { id: `gid://shopify/ProductVariant/${variantId}` } },
  );
  const v = (await res.json())?.data?.productVariant;
  if (!v?.inventoryItem?.id) {
    return Response.json({ ok: false, error: "variant_not_found" }, { status: 404 });
  }

  const inventoryItemId = v.inventoryItem.id.split("/").pop();
  const productId = v.product.id.split("/").pop();

  const sub = await prisma.subscriber.upsert({
    where: { shopId_email_variantId: { shopId: shopRow.id, email, variantId } },
    // Re-subscribing (or after a prior notify) resets them to pending.
    update: {
      status: "pending",
      inventoryItemId,
      productTitle: v.product.title,
      variantTitle: v.title,
      productHandle: v.product.handle,
      imageUrl: v.product.featuredImage?.url ?? null,
      price: v.price,
      notifiedAt: null,
    },
    create: {
      shopId: shopRow.id,
      email,
      variantId,
      inventoryItemId,
      productId,
      productTitle: v.product.title,
      variantTitle: v.title,
      productHandle: v.product.handle,
      imageUrl: v.product.featuredImage?.url ?? null,
      price: v.price,
    },
  });

  // Fire-and-forget the confirmation so the storefront gets a snappy response.
  sendConfirmationEmail(shopRow, sub).catch((err) =>
    console.error("[subscribe] confirmation email failed:", err),
  );

  return Response.json({ ok: true });
  } catch (err) {
    // appProxy throws a Response (e.g. 401 on a bad signature) — let Remix handle those.
    if (err instanceof Response) throw err;
    // Any real error: log server-side, return clean JSON so the widget never gets HTML.
    console.error("[subscribe] error:", err);
    return Response.json({ ok: false, error: "server_error" }, { status: 500 });
  }
};
