// Supabase Edge Function: send-push
// Sends Web Push notifications to subscribed devices
// Deploy: supabase functions deploy send-push

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT     = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@prepflow.io";

function b64urlToUint8(b64: string): Uint8Array {
  const pad = b64.replace(/-/g,"+").replace(/_/g,"/");
  const bin = atob(pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function uint8ToB64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}

async function buildVapidJwt(audience: string): Promise<string> {
  const enc = new TextEncoder();
  const headerB64  = uint8ToB64url(enc.encode(JSON.stringify({typ:"JWT",alg:"ES256"})));
  const payloadB64 = uint8ToB64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now()/1000) + 43200,
    sub: VAPID_SUBJECT,
  })));
  const unsigned = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw", b64urlToUint8(VAPID_PRIVATE_KEY),
    { name:"ECDSA", namedCurve:"P-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name:"ECDSA", hash:"SHA-256" }, key, enc.encode(unsigned)
  );
  return `${unsigned}.${uint8ToB64url(new Uint8Array(sig))}`;
}

async function sendOnePush(sub: any, payload: string): Promise<{ok:boolean, expired:boolean}> {
  const endpoint = sub.endpoint;
  const jwt = await buildVapidJwt(new URL(endpoint).origin);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      "Content-Type":  "application/json",
      "TTL":           "86400",
    },
    body: payload,
  });
  return { ok: res.status === 201 || res.ok, expired: res.status === 410 || res.status === 404 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: {
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"POST",
    "Access-Control-Allow-Headers":"Content-Type,Authorization",
  }});

  try {
    const body = await req.json();
    const { title, body: msgBody, icon, tag, type, targetUsers } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let q = supabase.from("push_subscriptions").select("*");
    if (targetUsers?.length) q = q.in("user_name", targetUsers);
    const { data: subs, error } = await q;
    if (error) throw error;
    if (!subs?.length) return new Response(JSON.stringify({sent:0}), {
      headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}
    });

    const payload = JSON.stringify({
      title, body: msgBody,
      icon: icon || "/icons/icon-192.png",
      badge: "/icons/icon-72.png",
      tag: tag || type || "wds",
      data: { type, url: "/" }
    });

    const expiredIds: number[] = [];
    let sent = 0;
    await Promise.all(subs.map(async row => {
      const result = await sendOnePush(JSON.parse(row.subscription), payload);
      if (result.ok) sent++;
      if (result.expired) expiredIds.push(row.id);
    }));

    // Clean up dead subscriptions
    if (expiredIds.length) {
      await supabase.from("push_subscriptions").delete().in("id", expiredIds);
    }

    return new Response(JSON.stringify({sent, failed: subs.length - sent, cleaned: expiredIds.length}), {
      headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}
    });
  } catch(err) {
    return new Response(JSON.stringify({error: String(err)}), {
      status:500, headers:{"Content-Type":"application/json"}
    });
  }
});
