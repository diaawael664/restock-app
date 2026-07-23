import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { restockQueue } from "../queue.server";

// ⭐ The differentiator. authenticate.webhook verifies the HMAC; we enqueue and
// return 200 immediately (Shopify requires < 5s). All real work happens in worker.ts.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  // payload: { inventory_item_id, location_id, available, updated_at }
  const available = Number(payload?.available ?? 0);
  if (available > 0) {
    await restockQueue.add(
      "restock",
      {
        shop,
        inventoryItemId: String(payload.inventory_item_id),
        available,
      },
      {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    );
  }

  return new Response(null, { status: 200 });
};
