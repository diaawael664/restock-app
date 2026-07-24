# Restock Alerts — App Review Testing Instructions

Paste this (trimmed) into the **"Provide testing instructions"** field of the Shopify App
submission form. Replace the bracketed placeholders with your real details.

---

## What the app does
Restock Alerts lets shoppers request an email when an out-of-stock product comes back in
stock. When the merchant restocks the item, the shopper is emailed automatically within
seconds. No customer accounts or checkout changes are involved.

## Scopes used
`read_products`, `read_inventory` only. The app does **not** access customer records,
orders, or payments. Shopper emails are collected directly via a storefront opt-in form.

## Test store
- Install URL / demo store: **https://alertstock.myshopify.com**
- Staff login (if needed): use your Shopify reviewer account, or request access from the developer below.

## Setup (one-time, ~1 minute)
1. Install the app. After OAuth it opens the embedded **Restock Alerts** dashboard in admin.
2. Go to **Online Store → Themes → Customize**.
3. Open a **product** template. In the **Product information** section click **Add block →
   Apps → Restock alert button**, then **Save**.
   *(Alternatively enable the app embed under Theme settings → App embeds → Restock Alerts.)*

## Core flow to verify
1. **Create a sold-out item:** pick any product variant and set its inventory to **0**
   (Products → [product] → set quantity 0). It now shows "Sold out".
2. **Storefront – subscribe:** open that product's page on the storefront. A **"Notify me
   when available"** button appears. Click it, enter an email you can check, and submit.
   → You should see "You're on the list" and receive a **confirmation email**.
3. **Restock:** back in admin, set the same variant's inventory to **5** (or any positive
   number).
   → Within a few seconds the subscribed email receives a **"back in stock" alert** with a
   one-click "Buy it now" link.
4. **Unsubscribe:** click the unsubscribe link at the bottom of either email → confirmation
   page loads and no further emails are sent for that item.
5. **Dashboard:** reload the embedded app → the stats reflect the subscriber and the alert sent.

## Billing (Shopify App Pricing / managed pricing)
- **Free** plan: up to 50 alerts per month.
- **Pro** plan: unlimited alerts.
- Plans are selected on Shopify's hosted pricing page (no external checkout). Reviewer/$0
  plans are treated as Pro, so all functionality is available during review.

## Privacy & mandatory compliance webhooks
- Privacy policy: **https://restock-alerts-diaa.fly.dev/privacy**
- `customers/data_request` → the shopper's stored records are compiled and emailed to the merchant.
- `customers/redact` → all of that shopper's records are deleted.
- `shop/redact` → all of the store's data is deleted (fired ~48h after uninstall).
- `app/uninstalled` → session/token cleanup on uninstall.

## Support
- Support email: **diaa13wael@gmail.com**
- Emergency developer contact: **Diaa Wael — diaa13wael@gmail.com**
