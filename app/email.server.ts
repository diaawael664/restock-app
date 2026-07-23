import { appendFileSync } from "node:fs";
import { Resend } from "resend";
import type { Shop, Subscriber } from "@prisma/client";

// Lazily construct the Resend client so a missing key doesn't throw at import time
// (and so EMAIL_DRY_RUN can bypass it entirely during tests).
let _resend: Resend | null = null;
function resendClient(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Dry-run: record instead of sending. Powers `npm run test:acceptance` without real mail.
const DRY_RUN = process.env.EMAIL_DRY_RUN === "1";
export type SentRecord = { type: "confirmation" | "alert"; to: string; subject: string };
export const __dryRunMailbox: SentRecord[] = [];

function record(rec: SentRecord) {
  __dryRunMailbox.push(rec);
  const logPath = process.env.EMAIL_DRY_RUN_LOG;
  if (logPath) appendFileSync(logPath, JSON.stringify(rec) + "\n");
  console.log(`[email:dry-run] ${rec.type} -> ${rec.to} :: ${rec.subject}`);
}

// The verified sending address (domain must have DKIM/SPF set up in Resend).
// e.g. "alerts@notifications.yourapp.com"
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || "alerts@example.com";
const APP_URL = process.env.SHOPIFY_APP_URL || "https://example.com";

const FONT =
  "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fromName(shop: Shop): string {
  return shop.fromName?.trim() || shop.shopDomain.replace(/\.myshopify\.com$/, "");
}

function fromHeader(shop: Shop): string {
  // Display name is per-shop branding; the address is our verified sending domain.
  return `${fromName(shop)} <${FROM_ADDRESS}>`;
}

function unsubUrl(sub: Subscriber): string {
  return `${APP_URL}/unsubscribe?token=${sub.unsubToken}`;
}

function buyUrl(shop: Shop, sub: Subscriber): string {
  // One-click add-to-cart permalink drops the shopper straight into checkout.
  return `https://${shop.shopDomain}/cart/${sub.variantId}:1?ref=restock`;
}

function logoBlock(shop: Shop): string {
  return shop.logoUrl
    ? `<img src="${esc(shop.logoUrl)}" height="28" alt="${esc(fromName(shop))}">`
    : `<strong style="font-size:18px;color:#111">${esc(fromName(shop))}</strong>`;
}

function variantLine(sub: Subscriber): string {
  return sub.variantTitle ? ` — ${esc(sub.variantTitle)}` : "";
}

// ── 5a. Confirmation email ──
function confirmationHtml(shop: Shop, sub: Subscriber): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:24px 0;font-family:${FONT}">
 <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
   <tr><td style="padding:28px 32px;border-bottom:1px solid #eee">${logoBlock(shop)}</td></tr>
   <tr><td style="padding:36px 32px">
     <h1 style="margin:0 0 12px;font-size:22px;color:#111">You're on the list ✅</h1>
     <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444">
       We'll email you the <strong>moment</strong>
       <em>${esc(sub.productTitle)}${variantLine(sub)}</em> is back in stock. No need to keep checking.
     </p>
     <table cellpadding="0" cellspacing="0"><tr>
       ${sub.imageUrl ? `<td width="80"><img src="${esc(sub.imageUrl)}" width="72" style="border-radius:8px"></td>` : ""}
       <td style="padding-left:14px;font-size:14px;color:#333">
         <strong>${esc(sub.productTitle)}</strong><br>${esc(sub.variantTitle)}<br>${esc(sub.price)}
       </td>
     </tr></table>
   </td></tr>
   <tr><td style="padding:20px 32px;border-top:1px solid #eee;font-size:12px;color:#999">
     Didn't sign up? <a href="${unsubUrl(sub)}" style="color:#999">Remove me</a>.
   </td></tr>
  </table>
 </td></tr>
</table>`;
}

// ── 5b. Back-in-stock alert (the money email) ──
function alertHtml(shop: Shop, sub: Subscriber): string {
  const brand = esc(shop.brandColor) || "#111111";
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:24px 0;font-family:${FONT}">
 <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
   <tr><td style="padding:28px 32px;border-bottom:1px solid #eee">${logoBlock(shop)}</td></tr>
   ${sub.imageUrl ? `<tr><td align="center" style="padding:28px 32px 0"><img src="${esc(sub.imageUrl)}" width="240" style="border-radius:10px"></td></tr>` : ""}
   <tr><td style="padding:24px 32px" align="center">
     <p style="margin:0 0 6px;font-size:13px;letter-spacing:.5px;text-transform:uppercase;color:${brand}">Back in stock</p>
     <h1 style="margin:0 0 8px;font-size:24px;color:#111">${esc(sub.productTitle)} is available again</h1>
     <p style="margin:0 0 22px;font-size:15px;color:#555">${esc(sub.variantTitle)} · ${esc(sub.price)} — but it may go fast.</p>
     <a href="${buyUrl(shop, sub)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:15px 34px;border-radius:8px">
       Buy it now →
     </a>
   </td></tr>
   <tr><td style="padding:20px 32px;border-top:1px solid #eee;font-size:12px;color:#999" align="center">
     You asked to be notified about this item. <a href="${unsubUrl(sub)}" style="color:#999">Unsubscribe</a>.
   </td></tr>
  </table>
 </td></tr>
</table>`;
}

export async function sendConfirmationEmail(shop: Shop, sub: Subscriber) {
  const subject = `You're on the list — ${sub.productTitle}`;
  if (DRY_RUN) return record({ type: "confirmation", to: sub.email, subject });
  await resendClient().emails.send({
    from: fromHeader(shop),
    to: sub.email,
    replyTo: shop.replyTo || undefined,
    subject,
    html: confirmationHtml(shop, sub),
    headers: { "List-Unsubscribe": `<${unsubUrl(sub)}>` },
  });
}

export async function sendRestockEmail(shop: Shop, sub: Subscriber) {
  const subject = `${sub.productTitle} is back in stock`;
  if (DRY_RUN) return record({ type: "alert", to: sub.email, subject });
  await resendClient().emails.send({
    from: fromHeader(shop),
    to: sub.email,
    replyTo: shop.replyTo || undefined,
    subject,
    html: alertHtml(shop, sub),
    headers: { "List-Unsubscribe": `<${unsubUrl(sub)}>` },
  });
}
