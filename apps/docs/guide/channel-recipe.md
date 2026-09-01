# From a raw clip to the channel

One walkthrough, end to end: a template that puts your intro, your watermark and your end card
around any video you hand it, and a destination that uploads the result to YouTube. It is written
against the job it replaces — an upload script with a fixed intro and a PNG watermark — and every
step is a thing you do once.

Two halves, and they are independent. The template works in the browser with nothing behind it. The
destination needs [a Videola server](/guide/self-hosting): an upload carries a secret, and a secret
in a browser is not a secret.

## The template

### 1. Build the video you want, once

Import the pieces — **Import media** in the header, or drag them onto the window:

- `intro.mp4`, your opener
- any video at all as a stand-in for the material somebody will hand the template later
- `outro.mp4`, your end card
- `watermark.png`, your logo

Lay them out:

1. On the video track: intro, stand-in, end card, in that order. Each import lands behind the last,
   so this is what dropping them in order already gives you.
2. Add a second video track and put the watermark on it, above the others. Drag its right edge until
   it spans everything.
3. Select the watermark and place it in the properties panel: **Position X (px)**, **Position Y
   (px)**, **Width (factor)**, **Height (factor)** and **Opacity** if it should sit back a little.
   The numbers are offsets from the middle of the frame, so a corner is one positive and one
   negative — and a picture smaller than the frame needs no scaling at all, which is the reason to
   export the logo at the size you want it.
4. If you want the cuts to fade rather than jump, select the stand-in and then the end card and set
   a **Transition** in the properties panel — a crossfade of one second is what the old script did.
   A transition sits at the head of the clip that carries it.

Play it through. What you see here is exactly what comes out of the template, with one clip swapped.

### 2. Save it as a template

**File → From a template → Save this project as a template**, and now the one decision that
matters:

- Tick **the stand-in clip only**. Ticked reads *asked for*: the assistant asks whoever uses the
  template to supply it.
- Leave the intro, the end card and the watermark **unticked** — *kept*. Kept means they are part of
  the template, and for a clip of footage that includes the file itself: the template travels with
  your intro and your logo inside it.
- For the stand-in, set **Length: follows the material** rather than *as in the template*.

That last one is what makes the template work with a video of any length. The timeline moves with the
slot: the end card slides along by whatever the new material added, and the watermark — which spanned
the clip that grew — is stretched to span it still. Nothing in the model knows which clip is a
watermark, and nothing needs to: a clip that covered the one that grew is exactly the clip that has
to grow with it.

Give it a name and write it. You get a `.videolat` file: your template, your intro, your end card and
your logo in one file you can copy to another machine.

### 3. Use it

**File → From a template**, pick yours, **Use this one**, answer the one question it asks, **Create
project**. What comes out is an ordinary project, editable like any other; nothing about it remembers
it was a template.

## The destination

### 1. A Google project that may upload

At [console.cloud.google.com](https://console.cloud.google.com):

1. Create a project, or pick one you already have.
2. **APIs & Services → Library → YouTube Data API v3 → Enable**.
3. **OAuth consent screen**: external, your app name, your address. Add the scope
   `https://www.googleapis.com/auth/youtube.upload`, and add yourself as a test user.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**. Keep the **client ID** and
   the **client secret**.

::: warning A token from an app left in "Testing" expires after seven days
Google does that on purpose. Press **Publish app** on the consent screen when you are done — the
warning screen about an unverified app stays, and the refresh token stops expiring.
:::

### 2. A refresh token

There is no browser dance in the server: it has nowhere to put a redirect, and it would only be a
second way to arrive at the same string. Run the flow once yourself. Save this as `token.mjs` and run
it with `node token.mjs` — it opens nothing you have to trust, and prints one line:

```js
import { createServer } from "node:http";
const id = process.env.CLIENT_ID, secret = process.env.CLIENT_SECRET;
const redirect = "http://localhost:8731";
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({
  client_id: id, redirect_uri: redirect, response_type: "code",
  scope: "https://www.googleapis.com/auth/youtube.upload",
  access_type: "offline", prompt: "consent",
}).toString();
console.log("Open this and allow it:\n" + url + "\n");
const code = await new Promise((resolve) => {
  const server = createServer((request, answer) => {
    const got = new URL(request.url, redirect).searchParams.get("code");
    answer.end("Done. You can close this tab.");
    if (got) { server.close(); resolve(got); }
  }).listen(8731);
});
const answer = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: id, client_secret: secret, code,
    redirect_uri: redirect, grant_type: "authorization_code",
  }),
});
console.log("refresh token:", (await answer.json()).refresh_token);
```

```bash
CLIENT_ID=… CLIENT_SECRET=… node token.mjs
```

The `http://localhost:8731` redirect has to be listed on the client in the console — under
**Authorised redirect URIs** on the OAuth client you just made.

### 3. Tell Videola

**File → Publishing destinations …**:

1. **Server**: the address of your Videola server and its token. Leave the address empty if the
   editor is being served by that same server.
2. **New destination**: kind **YouTube**, a name you will recognise, then **Client ID**, **Client
   secret** and **Refresh token**. Set **Visibility** to `unlisted` or `public` if you want anything
   other than `private`, which is what an upload is without it.
3. **Add the destination.**

The secrets go in and never come out. The list says a destination *holds* a refresh token; nothing
says what it is. Rotating one means writing it again, which is a click.

### 4. Publish

Export as usual, and pick your destination under **After exporting, upload to**. The encode happens in
your browser; the finished file goes to the server, which sends it on with the credentials it holds.
The title is the project's, and a failed upload says what the platform said.

## What this replaces

A script with a hard-coded intro, a watermark position in code and a token in a file next to it. The
difference is not that the steps are fewer — it is that the layout is a video you can look at and
change, the length is not baked into it, and the credentials live in one place that never reads them
back out.
