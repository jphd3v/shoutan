// Long tool output (every Maestro step, every Gradle task) goes to a log file on a laptop and
// only the outcome is printed, so a run costs a reader a few lines. CI, or VERBOSE=1, prints
// everything, since there the output is the only record.
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const quiet = !process.env.CI && !process.env.VERBOSE;
const OUTCOME = /\[(Passed|Failed)\]|Flows? (Passed|Failed)|^Built |BUILD (SUCCESSFUL|FAILED)/;

/** Output options for a child process: `stdio` to pass on, and `done(ok)` to call when it ends. */
export function logTo(path) {
  if (!quiet) return { stdio: 'inherit', done() {} };
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'w');
  return {
    stdio: ['ignore', fd, fd],
    done(ok) {
      closeSync(fd);
      const lines = readFileSync(path, 'utf8').split('\n');
      for (const line of lines) if (OUTCOME.test(line)) console.log(line.trim());
      console.log(ok ? `Passed. Full output: ${path}` : `Failed. End of ${path}:\n${lines.slice(-40).join('\n')}`);
    },
  };
}

/** Runs `fn` with a log, reporting the outcome whether it passes or throws. */
export function withLog(path, fn) {
  const log = logTo(path);
  try {
    const result = fn(log.stdio);
    log.done(true);
    return result;
  } catch (e) {
    log.done(false);
    throw e;
  }
}
