// Tiny assertion helpers for the scenario tests: every check prints PASS or FAIL, and any FAIL makes the
// process exit non-zero, which is what `node --test` reports.

export function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
}

export const wait = ms => new Promise(r => setTimeout(r, ms));

// The background script leaves timers running; end the process once a scenario is over.
export function done() {
  process.exit(process.exitCode ?? 0);
}
