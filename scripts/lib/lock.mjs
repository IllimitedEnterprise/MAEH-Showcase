/* One run at a time.
 *
 * The lock is a file created exclusively ('wx') holding the owner's pid and start time. A lock
 * whose owner is gone, or that is older than `staleMs`, is taken over; a live fresh one makes
 * the caller back off. GitHub Desktop or a person may be using the repository too, which is
 * why the nightly job also checks the git state before it touches anything. */

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export class LockHeld extends Error {
  constructor(message) {
    super(message);
    this.name = "LockHeld";
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function acquireLock(file, { staleMs = 2 * 3_600_000, now = () => Date.now(), pid = process.pid, isAlive = processAlive } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(file, "wx");
      writeSync(descriptor, JSON.stringify({ pid, startedAt: now() }));
      closeSync(descriptor);
      return { file, release: () => rmSync(file, { force: true }) };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let holder = null;
      try {
        holder = JSON.parse(readFileSync(file, "utf8"));
      } catch { /* an unreadable lock is treated as abandoned */ }
      const age = Number.isFinite(holder?.startedAt) ? now() - holder.startedAt : Infinity;
      const gone = Number.isInteger(holder?.pid) ? !isAlive(holder.pid) : true;
      if (age > staleMs || gone) {
        rmSync(file, { force: true });
        continue;
      }
      throw new LockHeld(`another run holds the lock (pid ${holder.pid}, started ${Math.round(age / 1000)} s ago)`);
    }
  }
  throw new LockHeld("could not take the lock");
}
