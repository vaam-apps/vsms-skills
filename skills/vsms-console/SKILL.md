---
name: vsms-console
description: "The vsms admin console — Next.js 15 with tRPC, R6's three-layer rule that forbids CSS classes in a view file, the @vsms/gateway upstream seam and the AsyncLocalStorage credential it forwards, and two runtime traps TypeScript's compiler cannot see. Load before adding or changing a screen, touching frontends/packages/gateway, or debugging a console page that renders wrong, crashes on a null, or 403s."
---

# vsms-console

> **Verified against vsms `0dbde02a` (2026-09-15).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

`frontends/apps/admin` (Next.js 15) plus `@vsms/gateway` (the upstream seam),
`@vsms/api` (tRPC routers), `@vsms/env` (validated config), `@vsms/hooks`, and
the generated-but-unused `@vsms/sms-client`.

Screens: dashboard, messages (list, detail, composer), jobs, workers, providers,
routes, simulator, sender IDs, webhooks, opt-outs, apps, users, roles, audit log,
settings, login.

## R4 — the console is optional

Some deployments ship the backends only. **No server-side code may depend on it
existing**, and every operator action needs a `sms-gateway` subcommand, not only
a screen. Review test: _if `frontends/apps/admin/` were deleted, would this still
work?_

## R6 — three layers, and a view file has no CSS classes

| Layer     | Lives in                                                                                           | May contain                                           | Must not contain                          |
| --------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| **Page**  | `app/<route>/page.tsx`                                                                             | Composition, route params                             | Any `className`, any markup, any fetching |
| **Smart** | `app/<route>/<name>-screen.tsx`                                                                    | Fetching, mutations, permissions, URL state, handlers | Any `className`, any raw markup           |
| **Dumb**  | `@vaam-apps/ui` (published), `components/**` (app-wide), `app/<route>/components/**` (route-local) | Markup, classes, CVA variants, iteration              | Fetching, business rules                  |

**Not a `className`, not a `cn(...)`, not a hoisted class constant, not a
`styles.ts` of class strings.** A screen file should read as: fetch,
permissions, handlers, and a tree of components. **If something in it could be
unit-tested without React, it does not belong there.**

That includes the supporting cast — class-holding consts, mapping objects, date
helpers, domain reducers — all of which belong in a pure module beside the
route, with a test. Extraction is what makes a test possible.

**No hardcoded tuning values either.** A poll interval or page size is
configuration and belongs in `@vsms/env`, validated at boot. The test is whether
a wrong value is _inconvenient_ (tuning — hoist it) or _unsafe_ (protocol —
leave it in code with a comment saying why). A PKCE transaction TTL stays in
code.

**Avoid `useState`.** URL state → `nuqs` (`useQueryStates` for grouped state);
server data → tRPC/react-query, **never mirrored into local state**; forms →
`react-hook-form`; non-rendering values → `useRef`; grouped transitions →
`useReducer`. Ephemeral single-value presentational state inside a dumb
component is fine; anything else needs a sentence in the PR.

**What `cargo xtask r6` cannot see:** anything in `components/**` (it scans
`app/` only), and a dumb component that fetches its own data. Both are
review-only. It never fails on `useState`, because R6 permits ephemeral state.

## The credential the console forwards

Every upstream call authenticates **as the signed-in human**, not as the
console's machine credential. The session token is forwarded by middleware as a
header and picked up by an `AsyncLocalStorage` scope set **once**, at the tRPC
route handler — so ~13 gateway functions across 9 files did not each need a
threaded parameter.

**`resolveUpstreamAccessToken()` throws if no scope was entered**, rather than
falling back. So a new gateway function gets the human token automatically, and
reaching for the machine one requires importing `getMachineAccessToken` **by
name**, which is greppable. Two documented exceptions:

- **`previewMessage`/`sendMessage`** — the send procedure hard-rejects any caller
  whose `kind` is not `"app"`.
- **`listMessagesForStream`** — the stream hub is a **process-wide singleton**,
  so an ambient credential would capture the _first_ operator's token into a
  shared interval and silently poll with it for everyone else.

**A real consequence, not a bug:** `Message.read` admits `auth().kind == "user"`
unscoped, so the list and dashboard now show **every app** to any signed-in
human. The live-update poll stays scoped to one app, so a row from another app
can appear and not receive a live update. The screen says so.

## Two traps `tsc` cannot see

**A nullable column serialises as an explicit JSON `null`, not an omitted key.**
Every type here used `field?: T | undefined` — internally consistent, wrong about
the wire. Real consequences: a wildcard route rendering `operator=null`, and a
screen crashing with `Cannot read properties of null`. Normalised **once**, in
`frontends/packages/gateway/src/json.ts`, replacing **fourteen** per-module
copies — two modules had never been caught at all.

The recursion is safe because every pre-serialised-JSON field is declared
`String` in the schema, so it arrives as an opaque string leaf. **Check that
before adding a structured column.**

**A `DELETE` on a `@version` model requires `If-Match`.** `deleteResource` takes
an optional known version — one request, no TOCTOU window — and falls back to a
`GET` first when none is supplied. Every screen already holds the version; pass
it.

## `@vaam-apps/ui`

External, versioned, changed in its own repository. Load the `vaam-ui` skill for
the component library itself. Three bump lessons: an identical export surface is
**not** identical behaviour (a changed default prop shipped under a patch
number); pnpm's 24-hour quarantine is a **hard failure** and its exclusion cannot
be swapped in one step; and a version bump legitimately breaking a class-string
test is that test working — read the diff, do not silence it.
