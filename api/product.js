const SUPABASE_URL = "https://qqkhbhiacrieqzyhqwyc.supabase.co";
const SUPABASE_KEY = "sb_publishable_l_eyFDL52Pc5HpJPaXXpQQ_H2d9aaDS";
const SITE = "https://smartdeal-india-six.vercel.app";

const esc = (v = "") => String(v).replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const safeLink = (value, retailer) => {
  try {
    const u = new URL(value);
    const hosts = retailer === "amazon"
      ? ["amazon.in","amazon.co.in","link.amazon","amzn.in","amzn.to"]
      : ["flipkart.com"];
    if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
    return hosts.some(h => u.hostname === h || u.hostname.endsWith("." + h)) ? u.href : "";
  } catch { return ""; }
};

module.exports = async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
  const id = String(req.query.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).send("Invalid product ID"); return;
  }
  try {
    const endpoint = new URL(SUPABASE_URL + "/rest/v1/products");
    endpoint.search = new URLSearchParams({
      select: "id,product_name,product_price,product_image_url,amazon_affiliate_link,flipkart_affiliate_link,category,description,is_active",
      id: "eq." + id,
      is_active: "eq.true",
      limit: "1"
    });
    const response = await fetch(endpoint, { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
    if (!response.ok) throw new Error("Catalogue request failed");
    const rows = await response.json();
    const p = rows[0];
    if (!p || !p.product_name || !(Number(p.product_price) > 0) || !p.product_image_url) {
      res.status(404).send("Product not found"); return;
    }
    const amazon = safeLink(p.amazon_affiliate_link, "amazon");
    const flipkart = safeLink(p.flipkart_affiliate_link, "flipkart");
    if (!amazon && !flipkart) { res.status(404).send("Product not found"); return; }
    const name = String(p.product_name);
    const price = Number(p.product_price);
    const image = String(p.product_image_url);
    const canonical = SITE + "/product/" + p.id;
    const description = String(p.description || (name + " price, product details and available retailer offers on SmartDeal India. Prices may change; check the retailer for the latest offer."));
    const schema = {
      "@context":"https://schema.org",
      "@type":"Product",
      "name":name,
      "image":[image],
      "description":description,
      "category":String(p.category || "Products"),
      "offers":{
        "@type":"Offer",
        "url":canonical
      }
    };
    const buttons = [
      amazon ? '<a class="amazon" href="' + esc(amazon) + '" target="_blank" rel="sponsored nofollow noopener">Check on Amazon ↗</a>' : "",
      flipkart ? '<a class="flip" href="' + esc(flipkart) + '" target="_blank" rel="sponsored nofollow noopener">Check on Flipkart ↗</a>' : ""
    ].join("");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} Price & Offers | SmartDeal India</title>
<meta name="description" content="${esc(description.slice(0,300))}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="product"><meta property="og:site_name" content="SmartDeal India">
<meta property="og:title" content="${esc(name)} Price & Offers | SmartDeal India">
<meta property="og:description" content="${esc(description.slice(0,300))}">
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${esc(image)}">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g,"\\u003c")}</script>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#172235;font:16px Arial,sans-serif}
header{background:#10233f;padding:18px max(18px,calc((100% - 1080px)/2));color:#fff}header a{color:#fff;text-decoration:none;font-weight:bold}
main{max-width:1080px;margin:28px auto;padding:0 18px}.crumb{font-size:13px;color:#64748b;margin-bottom:18px}
article{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;background:#fff;padding:24px;border-radius:16px}
img{width:100%;height:360px;object-fit:contain;background:#fff}
h1{font-size:28px;line-height:1.25}.price{font-size:27px;font-weight:800;color:#172235;margin:18px 0}
.category{color:#64748b;font-size:13px}.desc{line-height:1.65;color:#46546a}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}.actions a{padding:13px 17px;border-radius:9px;text-decoration:none;font-weight:bold}
.amazon{background:#ffcf69;color:#172235}.flip{background:#e8f1ff;color:#1559b5}
.note{font-size:12px;color:#64748b;line-height:1.5;margin-top:22px}
@media(max-width:680px){article{grid-template-columns:1fr;padding:15px}img{height:260px}h1{font-size:23px}}
</style></head><body><header><a href="/">SmartDeal India</a></header>
<main><div class="crumb"><a href="/" style="color:#1769e0">Home</a> › ${esc(p.category || "Products")} › ${esc(name)}</div>
<article><div><img src="${esc(image)}" alt="${esc(name)}" loading="eager"></div><div>
<div class="category">${esc(p.category || "Products")}</div><h1>${esc(name)}</h1>
<div class="price">Check current price on ${amazon ? "Amazon" : "Flipkart"}</div>
<p class="desc">${esc(description)}</p><div class="actions">${buttons}</div>
<p class="note">Affiliate disclosure: SmartDeal India may earn a commission from qualifying retailer purchases at no extra cost to you. The displayed price may change. Confirm the latest price, availability, delivery and product details on the retailer's website before buying.</p>
</div></article></main></body></html>`);
  } catch (error) {
    console.error("Product page error:", error);
    res.status(503).send("Product details are temporarily unavailable. Please try again.");
  }
};
