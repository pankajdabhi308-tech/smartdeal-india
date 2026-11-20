/* SmartDeal India — public browser client configuration.
   The publishable key is designed for browser use. Database RLS remains the security boundary.
   Never place a Supabase service_role or secret key in this file. */
(function () {
  "use strict";

  const SUPABASE_URL = "https://qqkhbhiacrieqzyhqwyc.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_l_eyFDL52Pc5HpJPaXXpQQ_H2d9aaDS";
  // Public browser credentials are safe to expose; table access is restricted by RLS.
  window.SMARTDEAL_SUPABASE_URL = SUPABASE_URL;
  window.SMARTDEAL_SUPABASE_KEY = SUPABASE_PUBLISHABLE_KEY;

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("SmartDeal India: Supabase JS library did not load.");
    document.documentElement.dataset.supabaseConnection = "library-error";
    return;
  }

  const client = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  window.smartDealSupabase = client;

  window.smartDealSupabaseReady = (async function () {
    const { data, error } = await client
      .from("products")
      .select("id")
      .limit(1);

    if (error) {
      document.documentElement.dataset.supabaseConnection = "error";
      console.error("SmartDeal India: Supabase connection check failed:", error.message);
      throw error;
    }

    document.documentElement.dataset.supabaseConnection = "connected";
    console.info("SmartDeal India: Supabase connection verified.");
    return { client, checkedRows: Array.isArray(data) ? data.length : 0 };
  })();
})();
