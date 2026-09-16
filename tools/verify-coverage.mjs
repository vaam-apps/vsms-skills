#!/usr/bin/env node
// verify-coverage — the parity gate for this repository.
//
// It fails in BOTH directions, deliberately, the way vsms's own
// `cargo xtask` guards do:
//
//   docs -> skills   a vsms feature page that no skill claims fails the gate.
//                    That is the half that catches "a feature shipped and
//                    nobody taught the agents about it".
//
//   skills -> docs   a path claimed in coverage.json that does not exist in
//                    the vsms checkout fails the gate. That is the half that
//                    catches a skill still describing something that moved,
//                    was renamed, or was deleted.
//
// A one-directional gate lets the map rot in the direction nobody looks. vsms
// learned that lesson twice over — see its own AGENTS.md on the live-Postgres
// suites CI never ran, and on the four separate incidents of documentation
// asserting something the code does not do.
//
// Usage:  node tools/verify-coverage.mjs [path-to-vsms-checkout]
//         VSMS_REPO=/path/to/vsms node tools/verify-coverage.mjs
//
// Exit 0 = parity. Exit 1 = a gap, named, with the file that closes it.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vsms = resolve(process.argv[2] ?? process.env.VSMS_REPO ?? "../vsms");

if (!existsSync(join(vsms, "AGENTS.md"))) {
  console.error(
    `verify-coverage: ${vsms} does not look like a vsms checkout ` +
      `(no AGENTS.md).\n` +
      `Pass the path: node tools/verify-coverage.mjs /path/to/vsms`,
  );
  process.exit(2);
}

const coverage = JSON.parse(readFileSync(join(REPO, "coverage.json"), "utf8"));
const failures = [];
const note = (s) => failures.push(s);

// A deliberately strict, dependency-free reader for the tiny subset of YAML a
// SKILL.md frontmatter is allowed to be: top-level `key: value` scalars only.
// It REJECTS what a real YAML parser rejects — chiefly an unquoted value
// containing ": ", which YAML reads as a nested mapping and which makes
// `npx skills add` skip the skill outright. Being stricter than the installer
// is safe; being looser is how a skill ships uninstallable and nothing says so.
function parseFrontmatter(text) {
  const value = {};
  for (const [i, raw] of text.split("\n").entries()) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      return { error: `line ${i + 1}: unexpected indentation (nested YAML)` };
    }
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(raw);
    if (!m) return { error: `line ${i + 1}: not a "key: value" pair` };
    const key = m[1];
    const v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length > 1) ||
      (v.startsWith("'") && v.endsWith("'") && v.length > 1)
    ) {
      value[key] = v.slice(1, -1).replace(/\\"/g, '"');
      continue;
    }
    if (v.includes(": ") || v.endsWith(":")) {
      return {
        error:
          `line ${i + 1}: "${key}" has an unquoted value containing ": ", ` +
          `which YAML reads as a nested mapping. Wrap the value in double quotes.`,
      };
    }
    if (/^[[{>|&*!%@`]/.test(v)) {
      return { error: `line ${i + 1}: "${key}" starts with a YAML indicator` };
    }
    value[key] = v;
  }
  return { value };
}

// ------------------------------------------------------------------- baseline
//
// A skill is true of *a* vsms, not of vsms. vsms tags releases for its images
// and SDKs, but a skill describes the tree, not a release — and the tree moves
// between tags. So the honest version identity is a commit and a date.
//
// This is REPORTED, never failed. Drift is the normal state between releases;
// what matters is that whoever reads the output knows it exists.

const baseline = coverage.baseline ?? {};
let drift = null;

const git = (...args) =>
  execFileSync("git", ["-C", vsms, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

if (baseline.vsmsRef) {
  try {
    const head = git("rev-parse", "HEAD");
    const headShort = head.slice(0, 8);
    const headDate = git("log", "-1", "--format=%cs", "HEAD");

    if (head.startsWith(baseline.vsmsRef) || baseline.vsmsRef.startsWith(head)) {
      drift =
        `baseline: vsms ${headShort} (${headDate}) — exactly the tree these ` +
        `skills were verified against`;
    } else {
      let ahead = "?";
      let behind = "?";
      try {
        const counts = git(
          "rev-list",
          "--left-right",
          "--count",
          `${baseline.vsmsRef}...HEAD`,
        ).split(/\s+/);
        behind = counts[0];
        ahead = counts[1];
      } catch {
        // The baseline commit is not in this checkout at all — a shallow clone,
        // or a fork. Saying so is more useful than a wrong number.
        behind = ahead = "unknown (baseline commit not in this checkout)";
      }
      drift =
        `baseline: these skills were verified against vsms ` +
        `${baseline.vsmsRef.slice(0, 8)} (${baseline.verifiedAt ?? "undated"}); ` +
        `this checkout is ${headShort} (${headDate}) — ` +
        `${ahead} commit(s) newer, ${behind} commit(s) it does not have.\n` +
        `            Version-sensitive claims carry the date they became true. ` +
        `See VERSIONING.md.`;
    }
  } catch {
    drift =
      `baseline: ${vsms} is not a git checkout — cannot report drift from ` +
      `${baseline.vsmsRef.slice(0, 8)}`;
  }
} else {
  note(
    `coverage.json has no "baseline" block. Every published skill set names the ` +
      `vsms commit it was verified against — see VERSIONING.md.`,
  );
}

// ---------------------------------------------------------------- skills side

const skillDirs = readdirSync(join(REPO, "skills")).filter((d) =>
  statSync(join(REPO, "skills", d)).isDirectory(),
);

for (const dir of skillDirs) {
  const skillMd = join(REPO, "skills", dir, "SKILL.md");
  if (!existsSync(skillMd)) {
    note(`skills/${dir}/ has no SKILL.md`);
    continue;
  }
  const src = readFileSync(skillMd, "utf8");
  const fm = /^---\n([\s\S]*?)\n---/.exec(src);
  if (!fm) {
    note(`skills/${dir}/SKILL.md has no YAML frontmatter`);
    continue;
  }
  // Parse the frontmatter the way the INSTALLER does, not the way a regex
  // would. A gate that validates a different grammar from the consumer is not
  // a gate.
  const yaml = parseFrontmatter(fm[1]);
  if (yaml.error) {
    note(
      `skills/${dir}/SKILL.md frontmatter is not valid YAML: ${yaml.error}\n` +
        `      \`npx skills add\` runs a real YAML parser and SKIPS a skill it ` +
        `cannot parse, so this skill does not install at all. A description ` +
        `containing ": " must be quoted.`,
    );
    continue;
  }
  const { name, description } = yaml.value;

  if (name !== dir) {
    note(
      `skills/${dir}/SKILL.md declares name "${name}" — it must equal the ` +
        `directory name, because that is what \`--skill\` resolves.`,
    );
  }
  if (!description) {
    note(`skills/${dir}/SKILL.md has no description — it will never trigger.`);
  } else if (description.length < 80) {
    note(
      `skills/${dir}/SKILL.md description is ${description.length} chars. ` +
        `A description is the ONLY thing an agent reads when deciding whether ` +
        `to load the skill; say what it covers AND when to reach for it.`,
    );
  }

  if (!(dir in coverage.skills)) {
    note(`skills/${dir}/ has no entry in coverage.json`);
  }

  // Rule 1 of VERSIONING.md: every skill names the vsms it was verified
  // against. Enforced rather than asked for, because the whole point is that
  // it must never be the line someone forgets.
  const stamp =
    /Verified against vsms `([0-9a-f]{7,40})` \((\d{4}-\d{2}-\d{2})\)/.exec(src);
  if (!stamp) {
    note(
      `skills/${dir}/SKILL.md carries no version stamp. Add, under the title:\n` +
        "        > **Verified against vsms `<sha>` (<YYYY-MM-DD>).** …  — see VERSIONING.md",
    );
  } else if (baseline.vsmsRef && !baseline.vsmsRef.startsWith(stamp[1])) {
    // A stamp NEWER than the baseline is correct and expected: one skill
    // re-verified against a later vsms without re-verifying the other twenty.
    // Requiring every stamp to equal the baseline would make a one-skill
    // correction cost a full re-verification pass — which is how you get
    // twenty-one rubber-stamps. So the rule is "at least the baseline".
    let descendant = false;
    try {
      execFileSync(
        "git",
        ["-C", vsms, "merge-base", "--is-ancestor", baseline.vsmsRef, stamp[1]],
        { stdio: "ignore" },
      );
      descendant = true;
    } catch {
      descendant = false;
    }
    if (!descendant) {
      note(
        `skills/${dir}/SKILL.md is stamped vsms ${stamp[1]}, which is not the ` +
          `baseline (${baseline.vsmsRef.slice(0, 8)}) and does not contain it. ` +
          `A stamp may be newer than the baseline — that is a skill re-verified ` +
          `on its own — but it may never be older or unrelated, because then the ` +
          `page makes claims about a tree nobody here has checked.`,
      );
    }
  }

  // Every references/*.md the SKILL.md points at must exist, and every file
  // under references/ must be reachable from SKILL.md. An unreferenced
  // reference page is a page no agent will ever open.
  const refDir = join(REPO, "skills", dir, "references");
  if (existsSync(refDir)) {
    const onDisk = readdirSync(refDir).filter((f) => f.endsWith(".md"));
    const linked = new Set(
      [...src.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)].map((m) => m[1]),
    );
    for (const f of onDisk) {
      if (!linked.has(f)) {
        note(`skills/${dir}/references/${f} is not linked from SKILL.md`);
      }
    }
    for (const f of linked) {
      if (!onDisk.includes(f)) {
        note(`skills/${dir}/SKILL.md links references/${f}, which is missing`);
      }
    }
  }
}

for (const skill of Object.keys(coverage.skills)) {
  if (!skillDirs.includes(skill)) {
    note(`coverage.json names skill "${skill}", which has no skills/ directory`);
  }
}

// ------------------------------------------------- skills -> vsms (paths live)

for (const [skill, entry] of Object.entries(coverage.skills)) {
  for (const p of entry.covers ?? []) {
    if (!existsSync(join(vsms, p))) {
      note(
        `coverage.json: skill "${skill}" claims ${p}, which does not exist in ` +
          `${vsms}. Either the path moved (update the claim AND the skill ` +
          `prose that cites it) or the feature was deleted (drop both).`,
      );
    }
  }
}

// ------------------------------------------- vsms -> skills (features covered)

// docs/flows/ is vsms's own feature index: one page per thing the system does.
// It is the closest machine-readable answer to "what are the features", which
// is exactly the list a skills repo has to keep up with.
const claimed = new Set(
  Object.values(coverage.skills).flatMap((e) => e.covers ?? []),
);

// RECURSIVE, deliberately. If a flow ever becomes "an overview plus a
// directory", enumerating one level would see half the pages and report
// success — exactly the "gate whose green means less than it looks" this
// repository exists to refuse.
const flowsDir = join(vsms, "docs", "flows");

if (!existsSync(flowsDir)) {
  note(
    `${vsms}/docs/flows does not exist. That directory is vsms's own feature ` +
      `index and this gate has nothing to check without it.`,
  );
}

const walk = (dir, prefix) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name), `${prefix}/${e.name}`)
      : e.name.endsWith(".md") && e.name !== "README.md"
        ? [`${prefix}/${e.name}`]
        : [],
  );

const flows = existsSync(flowsDir) ? walk(flowsDir, "docs/flows") : [];
const exempt = new Set(coverage.exempt ?? []);

// A detail page under an overview's directory is covered when the skill claims
// the page itself, the directory, or the overview page it was split out of.
// …but that fallback only extends to pages that existed when the skills were
// verified. A page added under a claimed directory SINCE the baseline is a
// feature nobody wrote a briefing for, and inheriting the parent's claim would
// hide exactly the case this gate exists to catch.
const existedAtBaseline = (path) => {
  if (!baseline.vsmsRef) return true; // no baseline: the gate already said so
  try {
    execFileSync(
      "git",
      ["-C", vsms, "cat-file", "-e", `${baseline.vsmsRef}:${path}`],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false; // absent at baseline, or the commit is not in this checkout
  }
};

const covers = (flow) => {
  if (claimed.has(flow) || exempt.has(flow)) return true;
  const dir = flow.slice(0, flow.lastIndexOf("/"));
  if (dir === "docs/flows") return false;
  if (!claimed.has(dir) && !claimed.has(`${dir}.md`)) return false;
  return existedAtBaseline(flow);
};

for (const flow of flows) {
  if (!covers(flow)) {
    const parent = flow.slice(0, flow.lastIndexOf("/"));
    const inherited =
      parent.length > "docs/flows".length &&
      (claimed.has(parent) || claimed.has(`${parent}.md`));
    note(
      inherited
        ? `${flow} was added to vsms AFTER the baseline ` +
            `(${baseline.vsmsRefShort ?? baseline.vsmsRef?.slice(0, 8)}).\n` +
            `      Its directory is claimed, but that claim was earned against a ` +
            `tree that did not contain this page. Read it, fold it into the ` +
            `owning skill, and claim the page explicitly — or exempt it with a ` +
            `reason.`
        : `${flow} is a vsms feature page that no skill covers.\n` +
            `      Add it — or its directory, or the overview it was split from — ` +
            `to a skill's "covers" in coverage.json, and write the prose that ` +
            `earns the claim. If it genuinely needs no skill, list it under ` +
            `"exempt" with a reason in "exemptReasons".`,
    );
  }
}

for (const e of exempt) {
  if (!flows.includes(e) && !existsSync(join(vsms, e))) {
    note(`coverage.json exempts ${e}, which no longer exists in vsms`);
  }
  if (!coverage.exemptReasons?.[e]) {
    note(`coverage.json exempts ${e} with no reason in "exemptReasons"`);
  }
}

// ------------------------------------------------------------------ the report

if (failures.length > 0) {
  console.error(`\nverify-coverage: ${failures.length} gap(s)\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  // Drift is printed on failure too, deliberately: "these skills are newer than
  // the tree you pointed me at" explains most of the gaps above when someone
  // runs this against an older vsms.
  if (drift) console.error(`\n  ${drift}`);
  console.error(
    `\nThis gate is the docs↔skills parity rule. A vsms feature that ships ` +
      `without a skill is a feature every agent will get wrong.\n`,
  );
  process.exit(1);
}

console.log(
  `verify-coverage: ${skillDirs.length} skills, ` +
    `${claimed.size} vsms paths claimed, ` +
    `${flows.length} feature pages, ` +
    `${exempt.size} exempt — parity against ${vsms}`,
);
if (drift) console.log(`            ${drift}`);
