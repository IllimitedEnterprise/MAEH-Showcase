#!/usr/bin/env python3
"""Hermes cron shim for the MAEH Showcase nightly job.

Hermes runs a cron job's --script from its own scripts folder and only accepts .py or .sh
files, so this thin forwarder lives there and does one thing: run the repository's own
nightly script with Node and hand its output back. The real logic, and every rule about
freezing, verifying and pushing, is in scripts/nightly.mjs in the repository.

What Hermes does with what this prints: if the LAST non-empty line is the JSON object
{"wakeAgent": false}, the agent is not run at all (no model call, no message). Anything
else wakes the agent with this output in front of it. The Node script already ends its
output with that line, so this shim only has to make sure it never swallows it, and that
a failure to even start Node still wakes the agent with an explanation.

Standard library only; works with Hermes' own Python.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys

TIMEOUT_SECONDS = int(os.environ.get("MAEH_SHIM_TIMEOUT_SECONDS", str(55 * 60)))
MIN_NODE_MAJOR = 22


def clean(text):
    """Printable ASCII only, bounded: Hermes pastes this output into a prompt."""
    return re.sub(r"[^\x09\x0A\x20-\x7E]", "?", str(text))[:4000]


def wake(reason):
    """Print a diagnosis and the wake gate, then finish. Always exit 0 so Hermes reads the gate."""
    print("ATTENTION " + clean(reason))
    print(json.dumps({"wakeAgent": True, "outcome": "error", "frozen": [], "pushed": False,
                      "attention": [clean(reason)[:160]]}))
    sys.exit(0)


def node_major(path):
    try:
        out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.match(r"v?(\d+)\.", out.strip())
    return int(match.group(1)) if match else None


def find_node():
    """MAEH_NODE, then PATH, then the Node that ships inside Hermes, then the usual install."""
    candidates = []
    if os.environ.get("MAEH_NODE"):
        candidates.append(os.environ["MAEH_NODE"])
    on_path = shutil.which("node")
    if on_path:
        candidates.append(on_path)
    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        found = glob.glob(os.path.join(local, "hermes", "tools", "node-*", "node.exe"))
        candidates.extend(sorted(found, reverse=True))
    candidates.append(os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "nodejs", "node.exe"))
    for path in candidates:
        if path and os.path.isfile(path):
            major = node_major(path)
            if major is not None and major >= MIN_NODE_MAJOR:
                return path
    return None


def find_repo():
    candidates = [os.environ.get("MAEH_SHOWCASE_REPO"), os.getcwd(),
                  os.path.join(os.path.expanduser("~"), "Documents", "GitHub", "MAEH-Showcase")]
    for path in candidates:
        if path and os.path.isfile(os.path.join(path, "scripts", "nightly.mjs")):
            return path
    return None


def main():
    # Plain LF on every platform, so the output is byte-for-byte what the Node script printed.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(newline="\n")
    repo = find_repo()
    if not repo:
        wake("the MAEH Showcase repository was not found; set MAEH_SHOWCASE_REPO")
    node = find_node()
    if not node:
        wake("no Node " + str(MIN_NODE_MAJOR) + " or newer was found; set MAEH_NODE")

    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "VIRTUAL_ENV", "PYTHONHOME")}
    env["PATH"] = os.path.dirname(node) + os.pathsep + env.get("PATH", "")
    try:
        done = subprocess.run([node, os.path.join("scripts", "nightly.mjs"), "--hermes"], cwd=repo, env=env,
                              capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        wake("the nightly job did not finish within " + str(max(1, TIMEOUT_SECONDS // 60)) + " minute(s)")
    except OSError as error:
        wake("the nightly job could not be started: " + str(error))

    out = clean(done.stdout).rstrip("\n")
    lines = [line for line in out.split("\n") if line.strip()]
    last = None
    if lines:
        try:
            last = json.loads(lines[-1])
        except ValueError:
            last = None
    if not isinstance(last, dict) or "wakeAgent" not in last:
        # The script died before it could print its own verdict: say so, and wake.
        shown = "\n".join(lines[-20:])
        wake("the nightly job exited with code " + str(done.returncode) + " without a verdict. " + shown.replace("\n", " | "))
    print(out)
    sys.exit(0)


if __name__ == "__main__":
    main()
