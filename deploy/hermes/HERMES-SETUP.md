# Setting up the nightly job in Hermes

A one-time setup. Nothing in this repository changes Hermes's configuration by itself: you
run these steps (or ask Hermes to, with this file as the instructions), and each one says
what it does and how to check it.

## What happens every night

1. At 01:00 Hermes's scheduler runs `maeh-showcase-nightly.py` (the shim in this folder).
2. The shim runs `node scripts/nightly.mjs`, which freezes yesterday's results (and any
   earlier day that was missed), ranks the accounts, verifies everything, commits, and pushes.
3. The script ends its output with one JSON line. If that line is `{"wakeAgent": false, ...}`
   Hermes stops there: **no model call, no message.** A quiet night costs nothing.
4. In every other case the agent (DeepSeek) is woken with the script's output in front of it,
   follows the `maeh-showcase` skill, and reports to you. That covers a problem, a partial day,
   a failed push, and the three **health-check days: Monday, Wednesday and Saturday**, when it
   checks that the last day froze, that CI and Pages are green, and that the scheduler is alive.

The days are set in `config/season.json` (`healthWakeDays`).

## 1. Prerequisites

- [ ] The Hermes gateway is running, and starts again after every logon.
      Check: `hermes cron status` says "Gateway is running". Without the gateway nothing fires.
- [ ] The PC is awake at 01:00 (no sleep or hibernate, or a wake timer). Hermes cannot wake it.
- [ ] `gh auth status` shows you logged in as `IllimitedEnterprise`. The nightly push uses it.
- [ ] The MAEH harness runs on this machine at 01:00 (it is read, never controlled).
- [ ] The private settings file exists: `%LOCALAPPDATA%\MAEH-Showcase\config.json`

      ```json
      { "harnessUrl": "http://127.0.0.1:<the harness port>", "harnessVarDir": "<path to the harness var folder>" }
      ```

      It stays on this machine and is never committed. `harnessVarDir` is the harness's `var`
      folder; it is how the job finds the close ledgers when the live harness is busy.
- [ ] `node scripts/nightly.mjs --status` run in the repository prints the frozen days.

## 2. Set Hermes's timezone

Hermes has no `timezone` set, so cron times follow a stored fixed offset and will fire an hour
off after a daylight-saving change (it corrects itself after one run, but the 01:00 job is
better not to wander). Add one line to `%LOCALAPPDATA%\hermes\config.yaml`:

```yaml
timezone: Europe/Berlin
```

This also fixes the same drift for the MCC Check Up job. The nightly script itself waits for a
day to settle for 30 minutes after midnight, so a one-hour drift in either direction is harmless.

## 3. Install the shim

Hermes only runs scripts from its own scripts folder:

```powershell
Copy-Item deploy\hermes\maeh-showcase-nightly.py "$env:LOCALAPPDATA\hermes\scripts\"
```

The shim finds the repository (`MAEH_SHOWCASE_REPO`, else the current folder, else
`Documents\GitHub\MAEH-Showcase`) and Node 22+ (`MAEH_NODE`, PATH, the Node inside Hermes, then
Program Files). To change either, set that variable in Hermes's environment.

## 4. Trust the repository's skills

Hermes only loads a repository's own skills after you trust it. Run this in the repository:

```powershell
hermes skills trust
hermes skills list | Select-String maeh-showcase
```

The skill is scanned each time it changes; a "dangerous" verdict quarantines it. At the time
of writing the verdict is "safe".

## 5. Create the job

Use the same delivery target as your MCC Check Up (`hermes cron list` shows it). `--pin` fixes
the model that is the Hermes default today, so a later model change does not silently alter it.

```powershell
hermes cron create "0 1 * * *" "<the prompt below>" `
  --name maeh-showcase-nightly `
  --workdir "<the folder of this checkout>" `
  --skill maeh-showcase `
  --script maeh-showcase-nightly.py `
  --deliver <your target> `
  --failure-deliver <your target> `
  --pin
```

### The job prompt

```text
The MAEH Showcase nightly script has just run and its output is shown above. You were woken because it needs a person: an attention line, a problem outcome, or a scheduled health-check day. Follow the maeh-showcase skill: triage the outcome with its runbook, do only what the runbook allows, run the verification commands afterwards, and finish with a report of at most ten lines saying what happened, what you did and what the owner needs to decide. Frozen files are never edited.
```

## 6. First run and checks

```powershell
hermes cron doctor
hermes cron list                 # note the job id
hermes cron run <id>             # runs on the next tick
hermes cron runs <id>            # the durable record of that run
```

On a quiet day the run is silent. To see the whole chain once, do the wake drill below. Also
open the newest file under `%LOCALAPPDATA%\hermes\cron\output\` and confirm the script output
ends with the JSON line, unaltered.

## 7. Drills (do each once)

- **Wake drill.** Create an empty file named `force-wake` in `%LOCALAPPDATA%\MAEH-Showcase\`,
  then `hermes cron run <id>`. The script wakes the agent once and removes the file. The agent
  should run the health check and report.
- **Failure drill.** Temporarily set `MAEH_NODE` to a path that does not exist in Hermes's
  environment, run the job, and confirm the agent is woken with "no Node 22 or newer was found".
  Put it back afterwards.
- **Pause and resume.** `hermes cron pause <id>` and `hermes cron resume <id>`.

## 7b. A day that was missed

If the PC or the gateway was off at 01:00, Hermes runs the job once when it comes back, and the
script freezes every pending day in order. Nothing needs doing.

## 8. Where things are

| What | Where |
|---|---|
| Frozen days | `results/YYYY/MM/YYYY-MM-DD/` |
| Standings and per-account reports | `stars/` |
| Last run, lock, label map, capture balances | `%LOCALAPPDATA%\MAEH-Showcase\` (never committed) |
| Anything a failed night set aside | `%LOCALAPPDATA%\MAEH-Showcase\quarantine\` |

`node scripts/nightly.mjs --status` summarises it. `node scripts/verify.mjs --all` re-checks
every file; it needs nothing but Node, so anyone can run it on a fresh clone.

## 9. Troubleshooting

- **The job never fires.** `hermes cron status`; if the gateway is down, start it
  (`hermes gateway`), and make it start at logon.
- **"The skill was not found."** The repository is not trusted: `hermes skills trust`.
- **The agent is woken every night.** Read the attention line in the run record; a health-check
  day always wakes it, and so does any problem.
- **The push fails.** `gh auth status`; then `node scripts/nightly.mjs --retry-push`.
