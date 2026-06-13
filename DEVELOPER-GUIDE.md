# Developer Guide

This is the "just tell me how to use it" guide. No jargon. If you're new to the team or new to
AI agents, start here and read top to bottom. It takes about ten minutes.

---

## What is eq-sparks, in one paragraph?

eq-sparks is a set of AI helpers ("agents") that live in one shared repo and get copied into each
of our EQ repos. You talk to them inside your editor — Claude Code or GitHub Copilot — by typing a
command like `/scaffold` or `/fix-defect`. They read the ticket, look at our existing code, write
the change the right way (using shared components, matching our patterns), test it, and have a
strict reviewer check it before handing it back to you. You stay in control: nothing is merged or
deployed automatically.

Think of it as a small, well-trained team that already knows our codebase rules, sitting inside
your editor.

---

## The two things you'll use

**Orchestrators** are the commands you run. Each one does a whole job from start to finish.
You type `/scaffold` to build a new feature, `/fix-defect` to fix a bug, `/unit-test` to add tests,
and so on. There are 12 of them (full list in [SAMPLE-PROMPTS.md](./SAMPLE-PROMPTS.md)).

**Agents** are the specialists an orchestrator calls behind the scenes. You usually don't call them
directly. For example `/scaffold` uses `@mfe` to build the UI piece, `@design-system` to make sure
it uses our component library, and `@critic` to review the result. There are 26 agents, grouped by
what they do (governance, core, frontend, BFF, platform).

You mostly just need the orchestrators. The agents do their thing automatically.

---

## Install it

> **First, a gotcha that bites everyone:** never paste square brackets into your terminal.
> In docs, `[--offline-only]` means "this flag is optional." But your shell (zsh) reads `[ ]` as a
> file-search pattern and throws `zsh: no matches found`. So type the flag *without* the brackets,
> or leave it off entirely.

Right now the repo isn't published to GitHub yet, so you install from your local clone. Run this
**from inside the repo you want to set up** (point the path at wherever you cloned eq-sparks):

```sh
# Full install — sets up both Claude Code and Copilot
node /path/to/eq-sparks/install.js --profile=fe-childmfe
```

That's it. It writes the agents into `.claude/` (for Claude Code) and `.github/` (for Copilot),
and sets up the hidden `.eq-sparks/` folder where the agents keep their notes, cache, and budget.

**Which profile do I pick?** Match it to the repo you're in:

| Your repo | Use this profile |
| --- | --- |
| eq-nexus-ui (the shell) | `fe-rootmfe` |
| a child MFE (saye / sip / shares) | `fe-childmfe` |
| eq-one-shared | `fe-shared` |
| eq-one-design-system | `fe-designsystem` |
| ExperienceAPI (the BFF) | `be-experienceapi` |

**Nicer option:** run `npm link` once inside the eq-sparks repo. After that you have a real
`eq-sparks` command and can just type `eq-sparks init --profile=fe-childmfe` from any repo.

**Copilot-only team, no orchestration?** Add `--offline-only`. It writes just the `.github/` files,
skips the hidden runtime, and never needs syncing — you re-run the install whenever you want updates.

---

## Your first run

1. Open your repo in Claude Code (or VS Code with Copilot).
2. Type the flagship command with a ticket number:

   ```
   /scaffold PBI 48217
   ```

3. Watch the console. It runs in clear stages and prints a card for each one. You'll see it:
   - pull the ticket from Azure DevOps,
   - check if the design has a Figma link (and pull it if so),
   - **check whether the thing you need already exists** before writing anything new,
   - plan where the code should go,
   - build it,
   - run a strict review, and
   - print a summary: what it made, where it put it, and how much budget it used.

4. Review the result like you would a teammate's PR. Nothing is committed for you.

No ticket number? You can describe the task in plain words instead:

```
/scaffold add a contributions summary panel to the SIP MFE
```

See [SAMPLE-PROMPTS.md](./SAMPLE-PROMPTS.md) for a prompt you can copy for every command.

---

## The everyday commands

| You want to… | Run | 
| --- | --- |
| Build a brand-new feature/screen | `/scaffold` |
| Add code to an existing feature | `/code-builder` |
| Fix a bug | `/fix-defect` |
| Add or improve unit tests | `/unit-test` |
| Check/fix accessibility | `/accessibility` |
| Find and fix security issues | `/security` |
| Speed something up | `/performance` |
| Review a pull request | `/review` |
| Fix issues from a pentest report | `/fix-pentest` |
| Make FE types match the BFF API | `/contract-sync` |
| Move duplicated code into eq-one-shared | `/refactor-shared` |
| Continue a run that was started elsewhere | `/resume` |

In Copilot these show up as **chat modes** (pick them from the chat mode menu) instead of slash
commands. Same names, same jobs.

---

## How a run actually works (the short version)

Every command follows the same shape, so once you've seen one you've seen them all:

1. **A planner (`@supervisor`) plans the stages and sets a budget.** It won't blow past the budget —
   if a job is getting expensive it stops and asks you.
2. **A check runs before any code is written** to see if what you need already exists somewhere
   (in the design system, in shared, in a sibling MFE). If it does, the agents reuse it instead of
   writing a duplicate. This is how we avoid copy-paste sprawl.
3. **Specialists do the work** — and independent pieces run at the same time, not one after another,
   so it's fast.
4. **A strict reviewer (`@critic`) checks everything** and can send it back to be fixed. It's
   deliberately picky — it's the quality gate, not a cheerleader.
5. **You get a summary** and decide what to do with it.

---

## Why it doesn't cost a fortune

We don't use the most expensive AI model for everything. Simple, mechanical jobs (running tests,
scanning for issues, updating docs) use the cheap, fast model. Normal coding uses a mid model. Only
the few "hard judgment" steps (planning, the strict review, security) use the top model — and those
run once per stage, not on every line. The agents also cache what they look up and never redo work
they've already done. A full governed run usually costs pennies. The details are in
[MODEL-AND-BUDGET-STRATEGY.md](./MODEL-AND-BUDGET-STRATEGY.md) if you're curious.

---

## Troubleshooting

**`zsh: no matches found: [--ide=copilot]`**
You pasted the square brackets. They mean "optional" in docs, not literal text. Remove them:
`--ide=copilot`.

**`npm error could not determine executable to run` / npx can't find the repo**
`npx github:equiniti-org/eq-sparks` only works once the repo is published to that GitHub org (a
one-time setup step, see [MANUAL-STEPS.md](./MANUAL-STEPS.md)). Until then use the local installer:
`node /path/to/eq-sparks/install.js --profile=…`.

**"I installed it but I don't see the agents in my file tree."**
They're in `.claude/` and `.github/`, which are hidden dot-folders. Turn on "show hidden files" in
your editor, or look at the visible source in the eq-sparks repo itself (`agents/`, `orchestrators/`,
`skills/`). In Copilot, the orchestrators show in the **Agents dropdown** as `…-orchestrator`.

**".eq-sparks/ is greyed out / gitignored — will the harness still work?"**
Yes. When you install, the full harness (guardrails, methodology, memory, profiles, skills) is copied
into `.eq-sparks/` and that folder is gitignored so it never clutters your commits. Gitignored does
**not** mean gone — the files are on disk, and the agents read them from `.eq-sparks/…` at runtime.
Don't edit them there; edit the canonical source in the eq-sparks repo and re-run the install/sync.

**"The slash command isn't there in Claude Code."**
Make sure you ran the install in *this* repo, then reload the window. Commands come from
`.claude/commands/`.

**"It asked me to authenticate ADO/Figma."**
That's the MCP sign-in — it's a browser login, once per session. No tokens are stored in the repo.
If the servers aren't set up yet, see [MANUAL-STEPS.md](./MANUAL-STEPS.md) (decision D1).

**"It changed `.claude/` or `.github/` and now my edit is gone."**
Those folders are generated. Never edit them by hand. Edit the real source (`agents/`, `skills/`,
`orchestrators/`) in the eq-sparks repo, then re-run the render: `node bin/render-claude.mjs` and
`node bin/render-copilot.mjs`.

---

## Where to go next

- [SAMPLE-PROMPTS.md](./SAMPLE-PROMPTS.md) — a copy-paste prompt for every command.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the whole thing fits together, with diagrams.
- [MANUAL-STEPS.md](./MANUAL-STEPS.md) — the one-time setup your lead needs to do (MCP, publishing).
- [CLAUDE.md](./CLAUDE.md) — the deeper reference for how the agents behave.
