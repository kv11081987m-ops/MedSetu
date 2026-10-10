// attach-verified-phone — saves an OTP-verified phone onto the CALLER's
// users row and marks it phone_verified (086). Used by AttachPhoneModal for
// Google/email customers: Firebase verifies the OTP in the browser, then the
// browser sends the Firebase ID token here. The token is verified server-side
// against Firebase's JWKS (same as firebase-bridge), so the client can't
// claim a phone it didn't verify. The caller's identity comes from their
// Supabase JWT (Authorization header), never from the request body.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_PROJECT_ID = "medsetu-m";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const firebaseJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

const ALLOWED_ORIGINS = new Set(["https://med-setu.vercel.app", "http://localhost:5173"]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let idToken: unknown;
  try {
    idToken = (await req.json())?.idToken;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!idToken || typeof idToken !== "string") return json({ error: "idToken is required" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey) return json({ error: "Server misconfigured" }, 500);
  if (!authHeader) return json({ error: "Not logged in" }, 401);

  // 1. Who is calling (their Supabase session)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Not logged in" }, 401);

  // 2. Which phone Firebase actually verified
  let phone10: string;
  try {
    const { payload } = await jwtVerify(idToken, firebaseJwks, {
      issuer: FIREBASE_ISSUER,
      audience: FIREBASE_PROJECT_ID,
      algorithms: ["RS256"],
    });
    const pn = payload.phone_number as string | undefined;
    if (!pn || !/^\+91[6-9]\d{9}$/.test(pn)) return json({ error: "Not an Indian mobile number" }, 400);
    phone10 = pn.slice(-10);
  } catch (err) {
    console.error("[attach-verified-phone] token verification failed:", err instanceof Error ? err.message : String(err));
    return json({ error: "Invalid or expired Firebase token" }, 401);
  }

  // 3. Save + mark verified (service_role-only RPC)
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.rpc("admin_set_verified_phone", {
    p_auth_id: user.id,
    p_email: user.email ?? null,
    p_phone: phone10,
  });
  if (error) {
    console.error("[attach-verified-phone] rpc failed:", error.message);
    return json({ error: "Could not save phone" }, 500);
  }
  if (!data?.success) return json({ error: data?.code ?? "failed", code: data?.code ?? "failed" }, data?.code === "duplicate" ? 409 : 400);

  return json({ success: true, phone: phone10 });
});
