/* The part of Hermes that decides whether a cron job wakes its agent, ported from
 * hermes-agent/cron/scheduler_prompt.py `_parse_wake_gate`:
 *
 *   the agent is skipped ONLY if the last non-empty stdout line is JSON {"wakeAgent": false};
 *   anything else - no output, non-JSON, a missing flag, wakeAgent true - wakes it.
 *
 * Kept here so a change to what the nightly job prints can never silently break the contract. */

export function hermesWakes(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return true;
  let gate;
  try {
    gate = JSON.parse(lines.at(-1).trim());
  } catch {
    return true;
  }
  return !(gate && typeof gate === "object" && !Array.isArray(gate)) || gate.wakeAgent !== false;
}

/* What the Hermes redactor looks for in a script's output: secret-named JSON keys and long hex digests. */
export function hermesWouldRedact(stdout) {
  const text = String(stdout);
  const keys = [...text.matchAll(/"([^"]+)"\s*:/g)].map((match) => match[1]);
  return keys.some((key) => /token|secret|password|api[_-]?key|authorization|credential/i.test(key)) || /\b[0-9a-f]{32,}\b/i.test(text);
}
