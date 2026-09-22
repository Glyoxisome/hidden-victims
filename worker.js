/**
 * auth-worker
 *
 * ONLY job: handle the GitHub OAuth exchange, because that step needs the Client
 * Secret, which must never be visible in browser code. Everything else (checking
 * collaborator status, reading/writing data files) happens directly from the
 * browser to api.github.com after this Worker hands over a token. This Worker is
 * never involved in an actual edit.
 *
 * Deploy this as its own Cloudflare Worker (separate from your Pages site).
 * Set these as Worker secrets (via `wrangler secret put NAME`, not hardcoded):
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 *
 * Change SITE_URL below to your real site's URL - it's where the browser gets
 * sent back to after login, carrying the token in the URL fragment.
 */

const SITE_URL = "https://menfacts.evidence.workers.dev"; // <-- change to your real site URL

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth/login") {
      return handleLogin(url, env);
    }
    if (url.pathname === "/auth/callback") {
      return handleCallback(request, url, env);
    }
    return new Response("Not found", { status: 404 });
  },
};

function handleLogin(url, env) {
  // Random string to protect against CSRF; verified again in the callback.
  const state = crypto.randomUUID();

  const redirectUri = new URL("/auth/callback", url).toString();
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "public_repo"); // write access to public repos
  authorizeUrl.searchParams.set("state", state);

  const headers = new Headers({ Location: authorizeUrl.toString() });
  headers.append(
    "Set-Cookie",
    `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`
  );
  return new Response(null, { status: 302, headers });
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleCallback(request, url, env) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, "oauth_state");

  if (!code) {
    return new Response("Missing code", { status: 400 });
  }
  if (!state || !expectedState || state !== expectedState) {
    return new Response("Invalid state (possible CSRF) - please try logging in again", {
      status: 400,
    });
  }

  // Exchange the temporary code for a real access token.
  // Requires the Client Secret - this is the one thing only this Worker can do.
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return new Response(
      "GitHub login failed: " + (tokenData.error_description || "unknown error"),
      { status: 400 }
    );
  }

  // Hand the token to the browser via a URL fragment (#...), not a query string.
  // Fragments never get sent to any server - not this Worker, not Cloudflare logs,
  // not GitHub - the browser keeps them entirely client-side. The site's JS reads
  // it from location.hash on load and moves it into sessionStorage.
  const redirectTo = `${SITE_URL}/#gh_token=${encodeURIComponent(tokenData.access_token)}`;

  const headers = new Headers({ Location: redirectTo });
  // Clear the state cookie now that it's served its purpose.
  headers.append("Set-Cookie", "oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/");

  return new Response(null, { status: 302, headers });
}
