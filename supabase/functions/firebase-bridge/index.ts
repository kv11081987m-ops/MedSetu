// firebase-bridge — Firebase phone-OTP → Supabase session bridge (L3)
//
// Called by OTPScreen.jsx right after verifyFirebaseOTP() succeeds, with the
// Firebase ID token. Verifies that token against Firebase's own public JWKS
// (no service account / Admin SDK needed for this part), finds-or-creates a
// matching Supabase auth.users row by phone, then hand-signs a
// GoTrue-shaped access token (HS256, project JWT secret) for the client to
// use with supabase.auth.setSession(). See the L3 design report for why:
// Supabase's "Third-Party Auth" (signInWithIdToken / accessToken option)
// doesn't fit this app — no real auth.users row, non-UUID auth.uid(),
// SIGNED_IN never fires. This function exists specifically to get a REAL
// UUID-keyed session so the rest of the app's RLS/AuthContext design keeps
// working unchanged.
//
// Known, accepted limitation (per explicit instruction — working over
// perfect for now): the returned session has no real GoTrue refresh token
// (there's no admin API to mint one for a phone-verified user without
// triggering a real SMS). The access token is valid for ~1 hour; when it
// expires, Supabase's background auto-refresh will fail silently (this
// app's existing spurious-SIGNED_OUT guard in AuthContext.jsx won't wipe
// local state), and the customer just needs to log in again via OTP to get
// a fresh one. Not handled proactively here — flagged, not solved.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import postgres from "postgres";

const FIREBASE_PROJECT_ID = "medsetu-m";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Fetched once per function instance and cached/re-fetched by `jose` itself
// as needed (handles Google's key rotation automatically).
const firebaseJwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));

const SESSION_TTL_SECONDS = 60 * 60; // 1 hour

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // ── Parse body ────────────────────────────────────────────────
  let idToken: unknown;
  try {
    const body = await req.json();
    idToken = body?.idToken;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!idToken || typeof idToken !== "string") {
    return jsonResponse({ error: "idToken is required" }, 400);
  }

  // ── 1. Verify the Firebase ID token against Firebase's public JWKS ──
  // Checks signature + aud + iss + exp — everything short of trusting the
  // client. No Firebase service account/Admin SDK required for this step.
  let phoneNumber: string | undefined;
  try {
    const { payload } = await jwtVerify(idToken, firebaseJwks, {
      issuer: FIREBASE_ISSUER,
      audience: FIREBASE_PROJECT_ID,
    });
    phoneNumber = payload.phone_number as string | undefined;
  } catch (err) {
    // Never log the token itself — only the verification failure reason.
    console.error(
      "[firebase-bridge] token verification failed:",
      err instanceof Error ? err.message : String(err)
    );
    return jsonResponse({ error: "Invalid or expired Firebase token" }, 401);
  }

  if (!phoneNumber) {
    return jsonResponse({ error: "Token has no phone_number claim" }, 400);
  }

  // ── 2. Find-or-create the matching Supabase Auth user ────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  // Named PROJECT_JWT_SECRET, not SUPABASE_JWT_SECRET — `supabase secrets set`
  // rejects custom secret names with a SUPABASE_ prefix.
  const jwtSecret = Deno.env.get("PROJECT_JWT_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !dbUrl || !jwtSecret) {
    console.error("[firebase-bridge] missing one or more required env vars");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Firebase's phone_number claim is "+919999999999", but Supabase's own
  // auth.users.phone is stored WITHOUT the leading '+' ("919999999999").
  // The original lookup compared the raw Firebase value against the
  // stored value directly — always missed, always fell through to
  // createUser, which then failed on the real duplicate ("Phone number
  // already registered"). Normalize to digits-only and use that
  // consistently for both the lookup and the createUser call, and also
  // match a '+'-prefixed value in the lookup in case any row was ever
  // written the other way — no silent assumption about which convention
  // holds live.
  const digitsOnlyPhone = phoneNumber.replace(/^\+/, "");

  let userId: string;
  try {
    // supabase-js's admin.listUsers() has no reliable server-side phone
    // filter — a direct, service-role Postgres query against auth.users is
    // the accurate way to check "does this phone already have an account".
    const sql = postgres(dbUrl, { max: 1 });
    try {
      const rows = await sql`
        SELECT id FROM auth.users
        WHERE phone = ${digitsOnlyPhone} OR phone = ${"+" + digitsOnlyPhone}
        LIMIT 1
      `;
      userId = (rows[0]?.id as string | undefined) ?? "";

      if (!userId) {
        const { data, error } = await admin.auth.admin.createUser({
          phone: digitsOnlyPhone, // match Supabase's own no-'+' convention
          phone_confirm: true,
        });
        if (error) {
          const alreadyExists = /already registered|already exists/i.test(error.message ?? "");
          if (!alreadyExists) {
            console.error("[firebase-bridge] createUser failed:", error.message);
            return jsonResponse({ error: "Could not create user" }, 500);
          }
          // Race: another concurrent bridge call (or a row our OR-match
          // still somehow missed) claimed this phone between our lookup
          // and this createUser call — re-look-up and use that user
          // instead of failing the whole request.
          const retryRows = await sql`
            SELECT id FROM auth.users
            WHERE phone = ${digitsOnlyPhone} OR phone = ${"+" + digitsOnlyPhone}
            LIMIT 1
          `;
          userId = (retryRows[0]?.id as string | undefined) ?? "";
          if (!userId) {
            console.error("[firebase-bridge] createUser reported duplicate but re-lookup found nothing");
            return jsonResponse({ error: "Could not resolve user" }, 500);
          }
        } else if (data?.user) {
          userId = data.user.id;
        }
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (err) {
    console.error(
      "[firebase-bridge] user lookup/create error:",
      err instanceof Error ? err.message : String(err)
    );
    return jsonResponse({ error: "Server error resolving user" }, 500);
  }

  // ── 3. Mint a GoTrue-shaped access token, signed with the project's own
  //    JWT secret — see the file header for why there's no admin API that
  //    just hands you a session for an already-verified phone user. ──────
  let accessToken: string;
  try {
    const secretKey = new TextEncoder().encode(jwtSecret);
    const now = Math.floor(Date.now() / 1000);
    accessToken = await new SignJWT({
      aud: "authenticated",
      role: "authenticated",
      phone: phoneNumber,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuedAt(now)
      .setExpirationTime(now + SESSION_TTL_SECONDS)
      .sign(secretKey);
  } catch (err) {
    console.error(
      "[firebase-bridge] token signing failed:",
      err instanceof Error ? err.message : String(err)
    );
    return jsonResponse({ error: "Server error minting session" }, 500);
  }

  return jsonResponse({
    access_token: accessToken,
    expires_in: SESSION_TTL_SECONDS,
    user_id: userId,
  });
});
