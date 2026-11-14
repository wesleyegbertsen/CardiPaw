# 86: share links use `/share#d=…`, not `/share?d=…`

Status: proposed, waiting for Wesley to confirm when he approves the plan in `docs/plans/86-share-app-links.md`.

## Context

Wesley chose a scoped path for share links so that the Android intent filter matches only `/share` and every other cardipaw.com link stays in the browser (issue #86). The format named in that decision was `https://cardipaw.com/share?d=…`.

## Decision

Keep the scoped path, but carry the payload in the fragment: `https://cardipaw.com/share#d=<payload>`.

## Why

- **Privacy promise.** `src/utils/shareCodec.ts:4-6`, `README.md:62` and `docs/features.md:62` all say that the payload is in the URL fragment and never reaches a server. A query string is sent with the request, so every share would end up in the access logs of cardipaw.com and of every self-hosted copy.
- **Long links.** The codec accepts up to 200 000 characters (`src/utils/shareCodec.ts:19`), and the modal only warns above 8 000 (`src/components/ShareLinkModal.vue:91`). nginx's default `large_client_header_buffers` is 4 x 8k, so a request line longer than 8 KB gets a 414 before the SPA fallback runs. A fragment is never part of the request line.
- **No cost to App Links.** Android matches an intent filter only on scheme, host and path. `/share#…` matches `android:path="/share"`, and the fragment arrives unchanged in the intent's data URI.

## Consequences

- The path is always exactly `/share`, so the filter uses `android:path="/share"`, not `pathPrefix` (which would also match `/shared…`).
- Legacy `#/share?d=…` links keep rendering in the browser and on the in-app hash route. They do not open the app: a `/share` filter cannot match path `/`.
