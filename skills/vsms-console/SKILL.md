---
name: vsms-console
description: "The vsms admin console — Next.js 15 with tRPC on @vaam-apps/ui's Material 3 Expressive shell, R6's three-layer rule that forbids CSS classes in a view file, the document-level handler that keeps links from reloading the page, tuning values coerced in @vsms/env, the @vsms/gateway upstream seam and the AsyncLocalStorage credential it forwards, and the runtime traps TypeScript's compiler cannot see. Load before adding or changing a screen, a link, a poll or a tuning value, touching frontends/packages/gateway, or debugging a console page that reloads, polls too often or never, renders wrong, crashes on a null, or 403s."
---

# vsms-console

> **Verified against vsms `90c0c705` (2026-10-21).** Version-sensitive claims
> below carry the date they became true — a feature on vsms's `main` may be
> absent from the tree you are editing. On an older or newer vsms, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/vsms-skills/blob/main/VERSIONING.md).

`frontends/apps/admin` (Next.js 15) plus `@vsms/gateway` (the upstream seam),
`@vsms/api` (tRPC routers), `@vsms/env` (validated config), `@vsms/hooks`, and
the generated-but-unused `@vsms/sms-client`.

Screens: dashboard, messages (list, detail), composer, jobs, workers,
providers, routes, simulator, sender IDs, webhooks, opt-outs, apps, users, roles,
audit log, settings, login.

**Routes, as of 2026-10-21 (vaam-apps/vsms#436):** the overview dashboard is the
landing page at `/` (`frontends/apps/admin/app/page.tsx`), the composer lives at
`/composer` (`app/composer/page.tsx`), and `/dashboard` only redirects to `/`
(`app/dashboard/page.tsx`, kept so old bookmarks work).
~~Screens: dashboard, messages (list, detail, composer), …~~ **Corrected
2026-10-21:** the composer was the landing route at `/` until #436 and the
dashboard lived at `/dashboard`; a link or a test that still expects the
composer at `/` now lands on the dashboard.

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
code. **Where it goes changed on 2026-10-21** — see "Tuning values" below.

**Avoid `useState`.** URL state → `nuqs` (`useQueryStates` for grouped state);
server data → tRPC/react-query, **never mirrored into local state**; forms →
`react-hook-form`; non-rendering values → `useRef`; grouped transitions →
`useReducer`. Ephemeral single-value presentational state inside a dumb
component is fine; anything else needs a sentence in the PR.

**What `cargo xtask r6` cannot see:** anything in `components/**` (it scans
`app/` only), and a dumb component that fetches its own data. Both are
review-only. It never fails on `useState`, because R6 permits ephemeral state.

## Links navigate client-side — do not bypass it (since 2026-10-21)

`@vaam-apps/ui`'s `SideNav` renders its rows as plain `<a href>` (the library
has no router dependency and no link-component prop), and so did a few of the
console's own links. A plain anchor is a **full document load**: middleware,
RSC, hydration and an empty query cache, every click. Measured in vsms#436 over
ten sidebar clicks: 10 document loads and 120 tRPC requests before, 0 and 9
after.

The fix is one document-level `click` listener, installed by `useClientLinks()`
(`frontends/apps/admin/app/use-client-links.ts`), which `ConsoleShell`
(`app/console-shell.tsx`) calls on every page, `/login` included. The decision
is the pure `clientHref`/`internalPath` in `app/client-links.ts`, tested in
`app/client-links.test.ts`. It hands a click to `router.push` only when **all**
hold: not already `defaultPrevented`, left button, no Meta/Ctrl/Shift/Alt, no
`download` attribute, `target` empty or `_self`, same origin, and the path is
**not** `/api` or under `/api/`. Hover (`pointerover`) and `focusin` on an
internal anchor prefetch its route.

What that means when you write a link:

- **A plain `<a href>` or a `next/link` `Link` is fine** — both end up
  client-side. For an action that is navigation, use `LinkButton`
  (`frontends/apps/admin/components/link-button.tsx`), not a `<button>` calling
  `router.push`, which loses middle-click and the URL on hover.
- **Anything that must be a real request lives under `/api/`.** Sign-out is a
  `<form action="/api/auth/logout" method="post">`
  (`app/components/account-slot.tsx`), and the login page's "Sign in with
  Keycloak" anchor points at `/api/auth/sso` (`app/login/page.tsx`): the
  handler runs on `/login` too, so the `/api/` exclusion is the only thing
  keeping that redirect a full navigation. A new route handler a link must reach (an auth
  step, a file) outside `/api/` would be swallowed into a client-side push.
- **A component that handles a link click itself calls `preventDefault()`** to
  opt that link out. The listener is registered in the **bubble** phase, so
  React's own root-delegated handlers run first. vsms's `AGENTS.md` and
  `client-links.ts`'s header both say "capture-phase"; the code
  (`document.addEventListener("click", onClick)`, no options) and
  `use-client-links.ts`'s own comment say bubble, and bubble is what makes the
  opt-out work — trust the code.
- **Do not wrap `SideNav` to intercept clicks.** Its floating rails and More
  sheet are portalled to `document.body`, outside any wrapper; that is why the
  listener is on `document`. If a later `@vaam-apps/ui` gives `SideNav` a
  link-component prop, vsms's own note is to use it and delete this.

## Tuning values: `@vsms/env`'s `tuning.ts` (since 2026-10-21)

**`SKIP_ENV_VALIDATION=1` used to skip coercion along with validation**, and both
demo compose files run the console with it set. Every tuning number reached its
caller as the raw string, which TypeScript could not see: the messages long-poll
deadline became `Date.now() + "2000"` (string concatenation — each poll returned
in ~30 ms, ~12 requests a second), and TanStack Query silently ignores a string
`refetchInterval`, so the dashboard, jobs, workers and webhook-attempt polls
**never ran at all**.

Now the tuning schemas live in one `TUNING` object
(`frontends/packages/env/src/tuning.ts`), and `env` is wrapped by
`withTuningCoerced` when `SKIP_ENV_VALIDATION` is set
(`frontends/packages/env/src/index.ts`): each tuning key is coerced from
`process.env`, or falls back to the schema's default, even with validation
skipped. Everything else stays raw. The keys as of 2026-10-21:

| Key                             | Default | Read by                                        |
| ------------------------------- | ------- | ---------------------------------------------- |
| `MESSAGE_STREAM_POLL_MS`        | 2000    | the Messages long-poll (and its tRPC router)   |
| `DIAGNOSTICS_POLL_MS`           | 5000    | Jobs, Workers, Webhooks                        |
| `AUDIT_LOG_PAGE_SIZE`           | 50      | the audit log                                  |
| `LIST_PAGE_SIZE` (new)          | 25      | Jobs only (`app/jobs/page.tsx`), server-paged  |
| `DASHBOARD_REFETCH_INTERVAL_MS` | 15000   | the dashboard (`app/page.tsx`)                 |
| `QUERY_STALE_TIME_MS` (new)     | 10000   | `TrpcProvider`'s `staleTime`, via `layout.tsx` |

**A new tuning value goes into `TUNING`, then into `createEnv`'s `server` block
and `runtimeEnv` in `index.ts`** — never a bare `z.coerce` inline, which a
validation skip bypasses. Read it server-side — a `page.tsx`, `layout.tsx`, or a
tRPC router such as `frontends/packages/api/src/routers/messages.ts` — and pass
it to a screen as a prop: `withTuningCoerced` reads `process.env`, which the
browser does not have. `tuning.ts`'s comment on
`LIST_PAGE_SIZE` still says Jobs pages client-side over a returned window;
`app/jobs/jobs-screen.tsx` sends `offset`/`limit` and pages on the server, and
nothing else reads the key yet.

**`QUERY_STALE_TIME_MS` exists because TanStack's default `staleTime` is 0**, so
every remount and window focus refetched every query. Inside the window, going
back to a screen shows cached data with no request; polled queries keep their
own `refetchInterval` regardless.

## Query retries skip a 4xx (since 2026-10-21)

TanStack retries a failed query three times with backoff by default — about
seven seconds of skeleton before a 404 or 403 screen appeared. `TrpcProvider`
(`frontends/packages/hooks/src/provider.tsx`) now sets
`retry: shouldRetryQuery` (`frontends/packages/hooks/src/retry.ts`, tested in
`retry.test.ts`): no retry when the tRPC error's `data.httpStatus` is a 4xx, up
to three for a network failure or a 5xx. **A screen gets its not-found or
forbidden state at once — render one.** The message detail, for one, reads the
providers and routes lists to name them and falls back to the bare id when a
role without `provider:read`/`route:read` gets a 403, which is not retried.

## App-wide dumb components (since 2026-10-21)

Added under `frontends/apps/admin/components/` by vaam-apps/vsms#436, next to
the older `status.ts`, `msisdn-display.tsx` and `encoding-preview.tsx`:
`PageHeader` (title, description, trailing `actions` — where a screen's primary
action such as "New route" goes), `SectionHeader`, `ListSurface` (every list,
with its filters in the toolbar), `ListToolbarRow`, `ChipGroup` (a `<fieldset>`
with a hidden legend — biome refuses `role="group"`), `FilterChip`, `LiveChip`,
`Caption`, `LinkButton`, and one `ErrorBanner` that replaced the route-local
`error-banner.tsx` copies (#436 deleted four). **Reach for these before writing a
route-local header, banner or toolbar.** `PageHeader`'s own header comment still
says the description is clamped to two lines; the markup has no clamp, and
`AGENTS.md` says it never clamps (a clamp hid the end of the Workers sentence
at 375 px).

## "Sign in with Keycloak": nothing new, from the console's side (since 2026-10-19)

**The console never talks to Keycloak and never sees an upstream token.** The
gateway is still the console's OP; the button is another way to reach the
gateway's authorize step (see the SSO page of `vsms-auth`). Four files, all
under `frontends/apps/admin/`:

- **`lib/sso-discovery.ts`** reads the gateway's OIDC discovery document (from
  `SMS_AUTH_ISSUER`, which may be an internal address) for a
  `vsms_sso_login_endpoint` member. **It never throws and never blocks a login**:
  a 2 s timeout, a 10 s cache, any failure means "no SSO button". That member is
  the only switch — there is **no console env var** to drift out of step with
  the gateway's, and R4 holds because nothing here is required.
- **`lib/sso.ts`** is pure and Edge-and-Node-portable (like `oidc.ts`). The
  discovery value becomes a **redirect target**, so it is held to an absolute
  `http(s)` URL whose path is exactly `/login/sso/start`, with no query,
  fragment or credentials.
- **`app/api/auth/sso/route.ts`** (`GET`) mints the **same** PKCE/state/nonce
  transaction cookie as the password path — fresh on every click, so a stale one
  from the login page cannot be what an SSO attempt completes against — and
  redirects the browser to the gateway. If the gateway no longer advertises SSO,
  the user lands on `/login?error=sso_unavailable` rather than a dead end.
- **`app/api/auth/callback/route.ts`** handles a refusal arriving as
  `?error=access_denied&state=...` **first**, verifying `state` against the
  cookie before anything else. `access_denied` becomes `/login?error=sso_failed`;
  `temporarily_unavailable` and `server_error` become `sso_unavailable`.

The login page renders the button as an `<a>` styled with `buttonVariants` — a
GET navigation, no client JS — only when discovery advertises SSO; **the
password form is always there** (break-glass). Both error messages are generic
on purpose (`login-errors.ts`, with a test that they never mention groups,
factors or accounts): the reason is in the gateway's log only. The route
handlers themselves are not unit-tested (they need `next/headers` and
`@vsms/env`); the pure logic in `lib/sso.test.ts` is.

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
the component library itself.

**`^0.5.0` as of 2026-10-21** (`frontends/apps/admin/package.json`) — the
Material 3 Expressive re-skin: a generated indigo palette, M3 corner and type
scales, Roboto Flex and JetBrains Mono (self-hosted), stadium fields, and
`StatusPill`/`StateChip` defaulting to size `md`, so a **dense table passes
`size="sm"`** (`messages-table.tsx`, `jobs-table.tsx`). The console runs
`SideNav` in its **default floating mode** — bottom toolbar below 640 px, rail
to 1279 px, in-flow sidebar from 1280 px — and the main column pads for it
(`app/components/console-chrome.tsx`). Until 2026-10-21 the shell owned a
daisyUI drawer and passed `smallScreen="off-canvas"`; both are gone, and that
file's header says why. A sticky `TopAppBar` (`app/components/top-app-bar.tsx`)
shows a breadcrumb from `locate` in `app/nav-groups.ts` and a theme toggle.
`pnpm-workspace.yaml` carries a version-scoped `@vaam-apps/ui@0.5.0` quarantine
exclusion until that release is a day old, and `AGENTS.md` records the vendored
`vaam-ui` skill copy as synced from `v0.5.0` (commit `678cb0a`).

Three bump lessons: an identical export surface is
**not** identical behaviour (a changed default prop shipped under a patch
number); pnpm's 24-hour quarantine is a **hard failure** and its exclusion cannot
be swapped in one step; and a version bump legitimately breaking a class-string
test is that test working — read the diff, do not silence it.
