# Sample Prompts

Copy-paste prompts for every command. Each one is real — change the ticket number or description
and run it.

**In Claude Code:** type the slash command in the chat box.
**In GitHub Copilot:** open the chat mode menu and pick the same name (e.g. "scaffold"), then type
your request. The names and behaviour are identical.

Two ways to give a command its input:
- **A ticket:** `PBI 48217` — it pulls the title, description, acceptance criteria, and any Figma
  link straight from Azure DevOps.
- **Plain words:** describe the task — useful when there's no ticket yet.

---

## Building features

### `/scaffold` — build something new

```
/scaffold PBI 48217
```
```
/scaffold add a holdings filter bar to the SIP dashboard, backed by a new ExperienceAPI sip endpoint
```
```
/scaffold PBI 48217 skip-figma
```
Use `skip-figma` when the design hasn't changed or isn't ready — it skips the Figma step.

### `/code-builder` — add to existing code

```
/code-builder PBI 50132
```
```
/code-builder add a "download statement" button to the existing SAYE summary card
```
Use this (not `/scaffold`) when the structure already exists and you're extending it.

---

## Fixing things

### `/fix-defect` — fix a bug

```
/fix-defect PBI 51904
```
```
/fix-defect the holdings total shows NaN when a fund has no price; here's the stack trace: <paste>
```

### `/fix-pentest` — fix findings from a pentest report

```
/fix-pentest ./reports/pentest-2026-06.md
```

---

## Quality

### `/unit-test` — add or improve tests

```
/unit-test src/features/holdings
```
```
/unit-test bring the sip-mfe stores up to 80% coverage
```

### `/accessibility` — WCAG audit and fix

```
/accessibility the SIP dashboard route
```
```
/accessibility PR 412
```

### `/security` — threat review and fix

```
/security the new contributions endpoint in the sip domain
```
```
/security PR 412
```

### `/performance` — profile and speed up

```
/performance the holdings list is slow to render with 500+ rows
```
```
/performance PR 412
```

### `/review` — review a pull request

```
/review PR 412
```
Runs several review angles at once (correctness, security, performance, accessibility, contract,
style), then a strict final check.

---

## Cross-repo housekeeping

### `/contract-sync` — make FE types match the BFF

```
/contract-sync sip
```
Reads the latest ExperienceAPI contract for the `sip` domain and patches the frontend types/clients
to match, failing if they've drifted.

### `/refactor-shared` — move duplicated code into eq-one-shared

```
/refactor-shared
```
```
/refactor-shared the date-formatting helpers duplicated across saye and sip
```

### `/resume` — continue a run started elsewhere

```
/resume latest
```
```
/resume <run-id>
```
Picks up a run that was started in the cloud (or earlier) without re-fetching ADO/Figma — it reads
the saved notes and continues from where it stopped.

---

## Calling a single agent (advanced)

Most of the time the orchestrator picks the right agents for you. Occasionally you want just one.
In Claude Code you can invoke a sub-agent directly by name, e.g. ask it to act as `@design-system`
or `@shared-curator`. Useful examples:

```
Use @design-system to check this component only uses eq-one-design-system parts, nothing hand-rolled.
```
```
Use @shared-curator to find code duplicated between saye and sip and tell me what should move to shared.
```
```
Use @contract to check our FE types still match the sip BFF contract.
```

The full agent list (26, grouped by category) is in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Tips

- **No ticket? Just describe it.** The agents handle plain-language tasks; they only skip the ADO
  step and take your words as the spec.
- **It always checks for existing code first.** If a component or store already exists, it reuses or
  extends it instead of writing a duplicate — that's intentional.
- **A strict reviewer gates every run.** If it sends work back for a fix, that's working as designed.
- **You get a summary at the end** with what changed, where it went, and the budget used. Review it
  like any PR before committing.
