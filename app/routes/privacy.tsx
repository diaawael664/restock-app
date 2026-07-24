import type { LoaderFunctionArgs } from "@remix-run/node";

// Publicly hosted privacy policy for the Shopify App Store listing.
// Live at:  https://<app-domain>/privacy
//
// Replace the two bracketed placeholders below (developer/legal name + support email)
// with your real details before submitting for review, then redeploy.
const DEVELOPER_NAME = "Diaa Wael";
const SUPPORT_EMAIL = "diaa13wael@gmail.com";
const EFFECTIVE_DATE = "July 24, 2026";

export const loader = async (_args: LoaderFunctionArgs) => {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — Restock Alerts</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;line-height:1.65;margin:0}
  main{max-width:760px;margin:0 auto;padding:48px 24px 96px}
  h1{font-size:30px;margin:0 0 4px}
  .eff{color:#777;font-size:14px;margin:0 0 32px}
  h2{font-size:20px;margin:36px 0 10px}
  p,li{font-size:15px;color:#333}
  ul{padding-left:22px}
  a{color:#1a56db}
  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
  th,td{border:1px solid #e5e5e5;padding:8px 10px;text-align:left;vertical-align:top}
  code{background:#f4f4f4;padding:1px 5px;border-radius:4px;font-size:13px}
  footer{margin-top:48px;padding-top:20px;border-top:1px solid #eee;color:#888;font-size:13px}
</style></head>
<body><main>
  <h1>Privacy Policy</h1>
  <p class="eff">Restock Alerts — Back in Stock · Effective ${EFFECTIVE_DATE}</p>

  <p>This policy explains what data the <strong>Restock Alerts</strong> app ("the App", "we", "us")
  collects, why, and how it is protected. The App is operated by ${DEVELOPER_NAME} and is installed by
  merchants on their Shopify stores to let shoppers request a notification when an out-of-stock product
  becomes available again.</p>

  <h2>1. Who this policy covers</h2>
  <ul>
    <li><strong>Merchants</strong> — Shopify store owners who install the App.</li>
    <li><strong>Shoppers</strong> — customers of those stores who submit their email to be notified about a restock.</li>
  </ul>

  <h2>2. Data we collect</h2>
  <table>
    <tr><th>Data</th><th>From whom</th><th>How collected</th><th>Why</th></tr>
    <tr><td>Store domain, store contact email, app settings (sender name, reply-to, brand color, logo URL, alert threshold)</td><td>Merchant</td><td>Shopify OAuth &amp; the app settings form</td><td>To operate the App and brand outgoing emails</td></tr>
    <tr><td>Shopper email address</td><td>Shopper</td><td>The storefront "Notify me" opt-in form</td><td>To send one back-in-stock notification for the item requested</td></tr>
    <tr><td>Product/variant identifiers, product title, price, image URL, subscription timestamp</td><td>Store catalog</td><td>Shopify Admin API at time of subscription</td><td>To identify the item and compose the notification</td></tr>
  </table>
  <p>We request only the <code>read_products</code> and <code>read_inventory</code> Shopify scopes. We do
  <strong>not</strong> access Shopify customer records, orders, or payment data.</p>

  <h2>3. How we use data</h2>
  <ul>
    <li>Send a confirmation email when a shopper subscribes, and a back-in-stock alert when the item returns.</li>
    <li>Show merchants aggregate stats (subscribers, alerts sent) in the app dashboard.</li>
    <li>Enforce plan limits and provide support.</li>
  </ul>
  <p>We do not sell personal data, and we do not use shopper emails for any purpose other than the
  restock notification they requested.</p>

  <h2>4. Sub-processors</h2>
  <p>We share data only with the infrastructure providers required to run the service:</p>
  <ul>
    <li><strong>Shopify</strong> — platform &amp; store data</li>
    <li><strong>Resend</strong> — transactional email delivery</li>
    <li><strong>Neon</strong> — encrypted PostgreSQL database hosting</li>
    <li><strong>Upstash</strong> — Redis job queue</li>
    <li><strong>Fly.io</strong> — application hosting</li>
  </ul>

  <h2>5. Retention &amp; deletion</h2>
  <ul>
    <li>A shopper's email is retained until they are notified or they unsubscribe.</li>
    <li>Every email includes a one-click unsubscribe link (and a <code>List-Unsubscribe</code> header).</li>
    <li>On a Shopify <code>customers/redact</code> request, we delete all of that shopper's records.</li>
    <li>On a <code>customers/data_request</code>, we compile the records we hold and provide them to the merchant.</li>
    <li>When a merchant uninstalls, Shopify sends <code>shop/redact</code> (~48 hours later) and we erase all of that store's data.</li>
  </ul>

  <h2>6. Security</h2>
  <p>Data is encrypted in transit (TLS) and at rest. Access to production systems is limited to authorized
  personnel. Webhooks are verified using Shopify's HMAC signatures.</p>

  <h2>7. Your rights</h2>
  <p>Depending on your jurisdiction (e.g. GDPR, CCPA) you may have the right to access, correct, or delete
  your personal data. Shoppers can unsubscribe at any time via the link in any email. For any other request,
  contact us or the store you subscribed through.</p>

  <h2>8. International transfers</h2>
  <p>Our providers may process data in the United States and other regions. We rely on their respective
  safeguards for lawful cross-border transfer.</p>

  <h2>9. Children</h2>
  <p>The App is not directed to children and we do not knowingly collect data from anyone under 16.</p>

  <h2>10. Changes</h2>
  <p>We may update this policy; the effective date above will change accordingly. Material changes will be
  reflected here.</p>

  <h2>11. Contact</h2>
  <p>Questions or data requests: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>

  <footer>Restock Alerts — Back in Stock. This page is served by the application itself.</footer>
</main></body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
