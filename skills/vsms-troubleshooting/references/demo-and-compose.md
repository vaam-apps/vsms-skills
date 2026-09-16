# The demo and the compose stacks

Three full-stack files, deliberately not merged: `compose.dev.yaml` (builds from
source — `just demo`), `compose.demo.yaml` (pulls published images),
`compose.yml` / `deploy/docker-compose.yml` (the deployment stack).

```bash
just demo-up      # bring-up only
just demo         # bring-up plus the evaluator's verdict
just demo-status
just demo-down
just demo-login   # the provisioned console credential
```

## The build race, and why the documented fix stopped working

Every builder stage shares one cargo cache-mount id, so building any one warms
the cache for the others — true for sequential builds, and a genuine race
(`failed to unpack package …: File exists`) when several build uncached at once.

`COMPOSE_PARALLEL_LIMIT=1` fixed it, **until Compose defaulted `build` to
`buildx bake`**, which fans every target into one concurrent invocation
regardless of that variable. `COMPOSE_BAKE=false` on top of it was _also_ not
sufficient. The recipe now forces strictly sequential per-image builds. If you
see this error, check what the recipe actually does before re-deriving the old
workaround.

Related: giving every service that shares a Dockerfile the **same explicit
`image:` tag** was necessary — without it, two builds from identical
`context`+`dockerfile` intermittently produced different tagged images, one of
them stale and missing a subcommand the source genuinely had.

## `up -d --wait` and a one-shot container

`--wait` fails the whole invocation the instant it observes an **Exited**
container in its wait set, **regardless of exit code** — so a one-shot that
printed a genuine success still made the recipe report failure. Splitting into
two `up` calls is worse: the second recreates and re-runs a side-effecting
one-shot. The fix needs neither: `depends_on` already sequences it, and `docker
compose wait <service>` blocks for real and returns the real exit code.

## Stale compose files are invisible to every gate

`cargo xtask workflow-paths` checks `.github/workflows/*.yml` only, **not**
compose files. Two independent sessions found the same drift live on the same
day, because nothing short of actually running `just demo` surfaces it:

- `dockerfile:` paths left behind by a directory rename.
- A `command:` naming a subcommand that had moved into its own crate and image.

If `just demo` fails at `resolve : lstat …: no such file or directory` or
`unrecognized subcommand`, suspect drift before suspecting your change.

## The demo has an evaluator, and its exit code is the point

`examples/node/demo-app` sends a real message, polls to a terminal state, and
runs its own receiver that `hooks` really POSTs to. It exits `0` **only if** the
message reached `delivered` **and** at least one webhook verified.

## Concurrent demos collide

`compose.dev.yaml` hardcodes a fixed global project name. A second session's
`just demo` tears down the first session's containers mid-run. Real, not
theoretical — it has interrupted a live verification.
