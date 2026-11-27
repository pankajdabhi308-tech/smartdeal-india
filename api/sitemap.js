const SUPABASE_URL = "https://qqkhbhiacrieqzyhqwyc.supabase.co";
const SUPABASE_KEY = "sb_publishable_l_eyFDL52Pc5HpJPaXXpQQ_H2d9aaDS";
const SITE = "https://smartdeal-india-six.vercel.app";

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  try {
    const urls = [
      SITE + "/", SITE + "/about.html", SITE + "/contact.html",
      SITE + "/privacy-policy.html", SITE + "/terms.html"
    ];
    let offset = 0;
    const pageSize = 500;
    while (true) {
      const endpoint = new URL(SUPABASE_URL + "/rest/v1/products");
      endpoint.search = new URLSearchParams({
        select: "id,product_name,product_price,product_image_url,amazon_affiliate_link,flipkart_affiliate_link,is_active",
        is_active: "eq.true",
        product_price: "gt.0",
        product_image_url: "not.is.null",
        order: "created_at.desc",
        limit: String(pageSize),
        offset: String(offset)
      });
      const response = await fetch(endpoint, {
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY }
      });
      if (!response.ok) throw new Error("Product feed request failed");
      const rows = await response.json();
      for (const p of rows) {
        const imageOk = typeof p.product_image_url === "string" && /^https:\/\//i.test(p.product_image_url);
        const retailerOk = Boolean(p.amazon_affiliate_link || p.flipkart_affiliate_link);
        if (p.id && p.product_name && imageOk && retailerOk && Number(p.product_price) > 0) {
          urls.push(SITE + "/product/" + encodeURIComponent(p.id));
        }
      }
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls.map(u => '<url><loc>' + u + '</loc></url>').join("") +
      '</urlset>';
    res.status(200).send(xml);
  } catch (error) {
    console.error("Sitemap error:", error);
    res.status(503).send('<?xml version="1.0"?><error>Sitemap temporarily unavailable</error>');
  }
};
