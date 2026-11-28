import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const ALLOWED_ORIGINS = new Set([
  "https://smartdeal-india-six.vercel.app",
]);
const MAX_BODY_BYTES = 4096;
const encoder = new TextEncoder();

function responseHeaders(origin: string | null, extra: Record<string, string> = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    headers.set("Access-Control-Max-Age", "600");
  }
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin, extraHeaders),
  });
}

function clientIp(req: Request): string | null {
  // Prefer proxy-provided single-address headers. The last X-Forwarded-For
  // value is used as a fallback because trusted proxies append their hop.
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? null,
  ];
  return candidates.find((value) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    !/[\s,]/.test(value)
  ) ?? null;
}

async function hmacFingerprint(key: CryptoKey, value: string): Promise<string> {
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return new Response(null, { status: 403, headers: { "Vary": "Origin" } });
    }
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ ok: false, error: "Origin not allowed." }, 403, null);
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "POST required." }, 405, origin, {
      "Allow": "POST, OPTIONS",
    });
  }

  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return jsonResponse({ ok: false, error: "JSON content type required." }, 415, origin);
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "Request is too large." }, 413, origin);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (encoder.encode(raw).byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "Request is too large." }, 413, origin);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ ok: false, error: "Invalid request body." }, 400, origin);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON request body." }, 400, origin);
  }

  // Honeypot: return a generic success without storing anything.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return jsonResponse({ ok: true, message: "Thanks for following SmartDeal India." }, 200, origin);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    body.consent !== true
  ) {
    return jsonResponse({
      ok: false,
      error: "Enter a valid email and agree to follow updates.",
    }, 400, origin);
  }

  const ip = clientIp(req);
  if (!ip) {
    return jsonResponse({
      ok: false,
      error: "Request could not be verified. Please try again.",
    }, 503, origin);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return jsonResponse({
      ok: false,
      error: "Server configuration is incomplete.",
    }, 503, origin);
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Use the existing server-side service-role key as an HMAC pepper.
    // Only keyed hashes are persisted; raw IP addresses and email values are not.
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(serviceKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const ipFingerprint = await hmacFingerprint(hmacKey, "ip:" + ip);
    const { data: ipAllowed, error: ipRateError } = await supabase.rpc(
      "consume_follow_rate_limit",
      {
        p_fingerprint: ipFingerprint,
        p_limit: 10,
        p_window_seconds: 600,
      },
    );
    if (ipRateError) throw ipRateError;
    if (ipAllowed !== true) {
      return jsonResponse({
        ok: false,
        error: "Too many follow requests. Please try again in a few minutes.",
      }, 429, origin, { "Retry-After": "600" });
    }

    const emailFingerprint = await hmacFingerprint(hmacKey, "email:" + email);
    const { data: emailAllowed, error: emailRateError } = await supabase.rpc(
      "consume_follow_rate_limit",
      {
        p_fingerprint: emailFingerprint,
        p_limit: 3,
        p_window_seconds: 3600,
      },
    );
    if (emailRateError) throw emailRateError;
    if (emailAllowed !== true) {
      return jsonResponse({
        ok: false,
        error: "This email has reached the request limit. Please try again later.",
      }, 429, origin, { "Retry-After": "3600" });
    }

    const { error } = await supabase.from("followers").upsert(
      { email, consent: true },
      { onConflict: "email", ignoreDuplicates: true },
    );
    if (error) throw error;

    return jsonResponse({
      ok: true,
      message: "You are following SmartDeal India.",
    }, 200, origin);
  } catch (_error) {
    console.error("follow-smartdeal request failed");
    return jsonResponse({
      ok: false,
      error: "Unable to save your follow request. Please try again.",
    }, 500, origin);
  }
});
