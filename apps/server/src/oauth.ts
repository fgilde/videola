import { randomBytes } from "node:crypto";

import type { Fetch } from "./publish";

/**
 * Signing in to a channel instead of pasting three secrets at it.
 *
 * Setting up a YouTube destination meant producing a client id, a client secret and a refresh token
 * by hand -- three values from two different pages of Google's console, one of which is only ever
 * shown by a tool nobody has installed. This is the flow those three values exist for: the server
 * holds the client once, the browser does the consent, and what comes back is the refresh token the
 * publisher already knew how to use.
 *
 * The client itself cannot be shipped. An OAuth client secret in a public repository is a secret
 * that is published, Google's terms say as much, and the quota attached to it would be one bucket
 * for every installation in the world. So the operator registers one, once, and every destination
 * after that is a button.
 *
 * The callback cannot carry the API token -- it is a redirect from Google, not a call from the
 * editor -- so what stands in for it is the `state`: minted here, single use, ten minutes, and
 * remembered only in memory. A callback whose state is unknown is a callback somebody else sent.
 */
export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface PendingAuth {
  state: string;
  /** What the destination will be called once the account has said yes. */
  name: string;
  redirectUri: string;
  expires: number;
}

const SCOPES = [
  // Uploading is the whole point; the readonly scope is what lets the destination be named after
  // the channel it publishes to rather than after whatever was typed in a box.
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

const LIFETIME_MS = 10 * 60 * 1000;

export class PendingAuths {
  #held = new Map<string, PendingAuth>();

  /** A nonce that survives the trip to Google and back, and nothing else. */
  start(name: string, redirectUri: string, now = Date.now()): PendingAuth {
    this.#sweep(now);
    const pending: PendingAuth = {
      state: randomBytes(24).toString("base64url"),
      name,
      redirectUri,
      expires: now + LIFETIME_MS,
    };
    this.#held.set(pending.state, pending);
    return pending;
  }

  /** Single use: a state that comes back twice is a replay, and the second try is not this flow. */
  take(state: string, now = Date.now()): PendingAuth | undefined {
    this.#sweep(now);
    const pending = this.#held.get(state);
    if (pending === undefined) return undefined;
    this.#held.delete(state);
    return pending;
  }

  #sweep(now: number): void {
    for (const [state, pending] of this.#held) {
      if (pending.expires <= now) this.#held.delete(state);
    }
  }
}

export function youtubeAuthUrl(client: OAuthClient, pending: PendingAuth): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", pending.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  // Offline and a forced consent, because the refresh token is the whole point and Google only
  // issues one on the first yes: without the prompt, a second destination on the same account comes
  // back with an access token that expires in an hour and nothing to renew it with.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", pending.state);
  return url.toString();
}

export interface Granted {
  refreshToken: string;
  accessToken: string;
}

export async function exchangeCode(
  client: OAuthClient,
  code: string,
  redirectUri: string,
  http: Fetch = fetch,
): Promise<Granted> {
  const answer = await http("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!answer.ok) throw new Error(`google refused the code: ${answer.status}`);
  const granted = (await answer.json()) as { refresh_token?: string; access_token?: string };
  if (granted.refresh_token === undefined || granted.access_token === undefined) {
    throw new Error("google returned no refresh token");
  }
  return { refreshToken: granted.refresh_token, accessToken: granted.access_token };
}

/**
 * What the account is called, so the destination can be named after it.
 *
 * A failure here is not a failure of the flow: the refresh token is already granted, and a
 * destination named after what somebody typed still publishes.
 */
export async function channelTitle(
  accessToken: string,
  http: Fetch = fetch,
): Promise<string | undefined> {
  try {
    const answer = await http(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!answer.ok) return undefined;
    const body = (await answer.json()) as {
      items?: { snippet?: { title?: string } }[];
    };
    return body.items?.[0]?.snippet?.title;
  } catch {
    return undefined;
  }
}
