/* The prompt-injection patterns Hermes applies to text that is put in front of an agent,
 * ported from hermes-agent/tools/threat_patterns.py (scope "context" is what AGENTS.md gets;
 * "strict" is the stricter set used for skills and memory). Hermes replaces a context file that
 * matches with "[BLOCKED ...]", which would silently delete this repository's guardrails, so
 * the files an agent reads are tested against every pattern here.
 *
 * Ported, not imported: CI has no Hermes. One pattern (hardcoded_secret) is simplified, because
 * it uses an inline regex flag that older Node versions do not support. */

const F = String.raw`(?:\w+\s+){0,8}`;
const SECRET_VAR = String.raw`\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b`;
const MODIFY = String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}`;

const PATTERNS = [
  [String.raw`ignore\s+${F}(previous|all|above|prior)\s+${F}instructions`, "prompt_injection", "all"],
  [String.raw`system\s+prompt\s+override`, "sys_prompt_override", "all"],
  [String.raw`disregard\s+${F}(your|all|any)\s+${F}(instructions|rules|guidelines)`, "disregard_rules", "all"],
  [String.raw`act\s+as\s+(if|though)\s+${F}you\s+${F}(have\s+no|don't\s+have)\s+${F}(restrictions|limits|rules)`, "bypass_restrictions", "all"],
  [String.raw`<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->`, "html_comment_injection", "all"],
  [String.raw`<\s*div\s+style\s*=\s*["'][^>]{0,2048}display\s*:\s*none`, "hidden_div", "all"],
  [String.raw`translate\s+[^\n]{0,512}\s+into\s+\w+(?:[\s-]+\w+){0,2}\s+and\s+(execute|run|eval)\b`, "translate_execute", "all"],
  [String.raw`do\s+not\s+${F}tell\s+${F}the\s+user`, "deception_hide", "all"],
  [String.raw`you\s+are\s+${F}now\s+(?:a|an|the)\s+`, "role_hijack", "context"],
  [String.raw`pretend\s+${F}(you\s+are|to\s+be)\s+`, "role_pretend", "context"],
  [String.raw`output\s+${F}(system|initial)\s+prompt`, "leak_system_prompt", "context"],
  [String.raw`(respond|answer|reply)\s+without\s+${F}(restrictions|limitations|filters|safety)`, "remove_filters", "context"],
  [String.raw`you\s+have\s+been\s+${F}(updated|upgraded|patched)\s+to`, "fake_update", "context"],
  [String.raw`\bname\s+yourself\s+\w+`, "identity_override", "context"],
  [String.raw`register\s+(as\s+)?a?\s*node`, "c2_node_registration", "context"],
  [String.raw`(heartbeat|beacon|check[\s\-]?in)\s+(to|with)\s+`, "c2_heartbeat", "context"],
  [String.raw`pull\s+(down\s+)?(?:new\s+)?task(?:ing|s)?\b`, "c2_task_pull", "context"],
  [String.raw`connect\s+to\s+the\s+network\b`, "c2_network_connect", "context"],
  [String.raw`you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b`, "forced_action", "context"],
  [String.raw`only\s+use\s+one[\s\-]?liners?\b`, "anti_forensic_oneliner", "context"],
  [String.raw`never\s+${F}(?:create|write)\s+${F}(?:script|file)\s+${F}disk`, "anti_forensic_disk", "context"],
  [String.raw`unset\s+\w*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC)\w*`, "env_var_unset_agent", "context"],
  [String.raw`\b(?:cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b`, "known_c2_framework", "context"],
  [String.raw`\bc2\s+(?:server|channel|infrastructure|beacon)\b`, "c2_explicit", "context"],
  [String.raw`\bcommand\s+and\s+control\b`, "c2_explicit_long", "context"],
  [String.raw`curl\s+[^\n]{0,2048}${SECRET_VAR}`, "exfil_curl", "all"],
  [String.raw`wget\s+[^\n]{0,2048}${SECRET_VAR}`, "exfil_wget", "all"],
  [String.raw`cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)`, "read_secrets", "all"],
  [String.raw`(send|post|upload|transmit)\s+[^\n]{0,2048}\s+(to|at)\s+https?://`, "send_to_url", "strict"],
  [String.raw`(include|output|print|share)\s+${F}(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)`, "context_exfil", "strict"],
  [String.raw`authorized_keys`, "ssh_backdoor", "strict"],
  [String.raw`(?:\b(?:echo|cat|cp|mv|dd|tee|install|printf|rsync|scp|ln|append|add|write|sed|chmod|chown|truncate|rm|touch|curl|wget|git)\b|\bopen\s*\(|>>?)[^\n]{0,512}(?:\$HOME/\.ssh|~/\.ssh)`, "ssh_access", "strict"],
  [String.raw`\$HOME/\.hermes/\.env|~/\.hermes/\.env`, "hermes_env", "strict"],
  [String.raw`${MODIFY}(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)`, "agent_config_mod", "strict"],
  [String.raw`${MODIFY}\.hermes/(config\.yaml|SOUL\.md)`, "hermes_config_mod", "strict"],
  [String.raw`(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}`, "hardcoded_secret", "strict"],
];

const SCOPES = { all: ["all", "context", "strict"], context: ["all", "context"], strict: ["all", "context", "strict"] };
const COMPILED = PATTERNS.map(([source, id, scope]) => ({ regex: new RegExp(source, "i"), id, scope }));
const INVISIBLE = new Set("​‌‍⁠⁢⁣⁤﻿‪‫‬‭‮⁦⁧⁨⁩");

/* Matched pattern ids for `scope` ("context" for AGENTS.md, "strict" for skills). */
export function scanForThreats(content, scope = "context") {
  const wanted = SCOPES[scope];
  const raw = String(content ?? "").slice(0, 65_536);
  const findings = [...new Set([...raw].filter((char) => INVISIBLE.has(char)))].map((char) => `invisible_unicode_U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
  const normalised = raw.normalize("NFKC");
  for (const { regex, id, scope: patternScope } of COMPILED) {
    if (wanted.includes(patternScope) && regex.test(normalised)) findings.push(id);
  }
  return findings;
}

export const PATTERN_COUNT = PATTERNS.length;
