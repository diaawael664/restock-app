import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

// Public one-click unsubscribe. Required for deliverability and by law.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = new URL(request.url).searchParams.get("token");
  let message = "This unsubscribe link is invalid or has expired.";

  if (token) {
    const sub = await prisma.subscriber.findUnique({ where: { unsubToken: token } });
    if (sub) {
      if (sub.status !== "unsub") {
        await prisma.subscriber.update({
          where: { id: sub.id },
          data: { status: "unsub" },
        });
      }
      message = "You've been removed. You won't receive any more restock alerts for this item.";
    }
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f6f6;margin:0">
  <div style="max-width:480px;margin:12vh auto;background:#fff;border-radius:12px;padding:40px 32px;text-align:center">
    <h1 style="font-size:20px;color:#111;margin:0 0 12px">Restock alerts</h1>
    <p style="font-size:15px;color:#555;line-height:1.6;margin:0">${message}</p>
  </div>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
