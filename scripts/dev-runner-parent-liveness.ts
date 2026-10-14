import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

export interface ParentLivenessOptions {
  readonly intervalMs?: number;
  readonly initialParentPid?: number;
  readonly getParentPid?: () => number;
  readonly isParentAlive?: (pid: number) => boolean;
  readonly onParentExit: () => void;
}

export function isParentAlive(
  pid: number,
  processProbe: (pid: number, signal: number) => unknown = (parentPid, signal) =>
    process.kill(parentPid, signal),
): boolean {
  try {
    processProbe(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but cannot be probed by this user.
    // Treat unknown probe failures as alive too; only ESRCH proves that
    // the parent no longer exists.
    return !(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
  }
}

/**
 * Detects loss of an uncontrolled parent process. An outer Vite+ invocation
 * cannot pass the supervisor's liveness pipe through to this runner, so this
 * is the portable fallback for that one process boundary.
 */
export function watchParentLiveness(options: ParentLivenessOptions): Effect.Effect<void> {
  const initialParentPid = options.initialParentPid ?? process.ppid;
  const getParentPid = options.getParentPid ?? (() => process.ppid);
  const parentIsAlive = options.isParentAlive ?? isParentAlive;
  return Effect.sync(() => {
    if (getParentPid() === initialParentPid && parentIsAlive(initialParentPid)) {
      return true;
    }

    options.onParentExit();
    return false;
  }).pipe(
    Effect.repeat({
      schedule: Schedule.spaced(Duration.millis(options.intervalMs ?? 250)),
      while: (parentIsAlive) => parentIsAlive,
    }),
    Effect.asVoid,
  );
}
