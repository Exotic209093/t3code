import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

// oxlint-disable-next-line t3code/no-global-process-runtime -- This subprocess fixture chooses whether the host can detach process trees.
describe.skipIf(process.platform === "win32")("dev-runner parent liveness", () => {
  it("unwinds the runner and supervisor when the outer owner is hard-killed", async () => {
    const runnerModuleUrl = NodeURL.pathToFileURL(
      NodePath.resolve(import.meta.dirname, "../../../scripts/dev-runner-parent-liveness.ts"),
    ).href;
    const supervisorModuleUrl = NodeURL.pathToFileURL(
      NodePath.resolve(import.meta.dirname, "dev-electron-parent-liveness.mjs"),
    ).href;
    const effectModuleUrl = import.meta.resolve("effect/Effect");
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-parent-liveness-"));
    const supervisorMarker = NodePath.join(directory, "supervisor-exit");
    const runnerMarker = NodePath.join(directory, "runner-exit");
    const supervisorCode = `import * as NodeFS from "node:fs"; import { watchParentLiveness } from ${JSON.stringify(supervisorModuleUrl)}; watchParentLiveness({ onParentExit: () => { NodeFS.writeFileSync(${JSON.stringify(supervisorMarker)}, "exited"); process.exit(0); } });`;
    const runnerCode = `import * as NodeChildProcess from "node:child_process"; import * as NodeEvents from "node:events"; import * as Effect from ${JSON.stringify(effectModuleUrl)}; import * as NodeFS from "node:fs"; import { watchParentLiveness } from ${JSON.stringify(runnerModuleUrl)}; const supervisor = NodeChildProcess.spawn(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(supervisorCode)}], { stdio: ["ignore", "ignore", "inherit", "pipe"] }); const supervisorExit = NodeEvents.once(supervisor, "exit"); const watchdog = watchParentLiveness({ onParentExit: () => {} }); console.log("PIDS", process.pid, supervisor.pid, process.ppid); await Effect.runPromise(watchdog); NodeFS.writeFileSync(${JSON.stringify(runnerMarker)}, "seen"); supervisor.stdio[3].end(); await supervisorExit; NodeFS.writeFileSync(${JSON.stringify(runnerMarker)}, "exited"); process.exit(0);`;
    const owner = NodeChildProcess.spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import * as NodeChildProcess from "node:child_process"; const runner = NodeChildProcess.spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", ${JSON.stringify(runnerCode)}], { stdio: ["ignore", "inherit", "inherit"], detached: true }); runner.unref(); setTimeout(() => {}, 60_000);`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], detached: true },
    );
    const ownerExit = NodeEvents.once(owner, "exit");
    const capturedPids = new Set([owner.pid]);
    let markerWatcher;
    let output = "";
    owner.stdout.setEncoding("utf8");
    owner.stdout.on("data", (chunk) => {
      output += chunk;
    });

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          owner.stdout.off("data", onData);
          reject(new Error(`fixture did not start: ${output}`));
        }, 5_000);
        const onData = () => {
          if (!/PIDS \d+ \d+ \d+\r?\n/.test(output)) return;
          clearTimeout(timeout);
          owner.stdout.off("data", onData);
          resolve();
        };
        owner.stdout.on("data", onData);
        // The collector above may have observed readiness before this waiter
        // was registered. Check the accumulated output immediately as well.
        onData();
      });
      const [, runnerPidText, supervisorPidText] = output.match(/PIDS (\d+) (\d+) \d+\r?\n/) ?? [];
      const runnerPid = Number(runnerPidText);
      const supervisorPid = Number(supervisorPidText);
      expect(Number.isInteger(runnerPid)).toBe(true);
      expect(Number.isInteger(supervisorPid)).toBe(true);
      capturedPids.add(runnerPid);
      capturedPids.add(supervisorPid);

      owner.kill("SIGKILL");
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`fixture did not unwind: ${output}`)),
          5_000,
        );
        const finish = (error) => {
          clearTimeout(timeout);
          markerWatcher?.close();
          markerWatcher = undefined;
          if (error) reject(error);
          else resolve();
        };
        markerWatcher = NodeFS.watch(directory, () => {
          if (NodeFS.existsSync(runnerMarker) && NodeFS.existsSync(supervisorMarker)) {
            finish();
          }
        });
        if (NodeFS.existsSync(runnerMarker) && NodeFS.existsSync(supervisorMarker)) {
          finish();
        }
      });

      await ownerExit;
      expect(owner.pid).toBeDefined();
    } finally {
      markerWatcher?.close();
      const [, runnerPidText, supervisorPidText] = output.match(/PIDS (\d+) (\d+) \d+\r?\n/) ?? [];
      const runnerPid = Number(runnerPidText);
      const supervisorPid = Number(supervisorPidText);
      if (Number.isInteger(runnerPid)) capturedPids.add(runnerPid);
      if (Number.isInteger(supervisorPid)) capturedPids.add(supervisorPid);
      for (const pid of capturedPids) {
        if (!Number.isInteger(pid) || pid === process.pid) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          // The fixture is already unwinding; leave cleanup failures to the
          // process supervisor rather than masking the assertion failure.
          void error;
        }
      }
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
