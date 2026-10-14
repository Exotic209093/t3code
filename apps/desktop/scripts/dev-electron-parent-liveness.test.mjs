import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

describe("dev-electron parent liveness", () => {
  it("exits a subprocess fixture when the runner-owned pipe closes", async () => {
    const moduleUrl = NodeURL.pathToFileURL(
      NodePath.resolve(import.meta.dirname, "dev-electron-parent-liveness.mjs"),
    ).href;
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { watchParentLiveness } from ${JSON.stringify(moduleUrl)}; watchParentLiveness({ onParentExit: () => process.exit(0) });`,
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe"] },
    );
    const childPid = child.pid;
    expect(typeof childPid).toBe("number");

    child.stdio[3].end();
    const [code, signal] = await NodeEvents.once(child, "exit");
    expect(code).toBe(0);
    expect(signal).toBe(null);
  });

  it("aborts a pending resource wait when the runner-owned pipe closes", async () => {
    const livenessModuleUrl = NodeURL.pathToFileURL(
      NodePath.resolve(import.meta.dirname, "dev-electron-parent-liveness.mjs"),
    ).href;
    const resourcesModuleUrl = NodeURL.pathToFileURL(
      NodePath.resolve(import.meta.dirname, "wait-for-resources.mjs"),
    ).href;
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { watchParentLiveness } from ${JSON.stringify(livenessModuleUrl)}; import { waitForResources } from ${JSON.stringify(resourcesModuleUrl)}; const controller = new AbortController(); watchParentLiveness({ onParentExit: () => controller.abort() }); try { await waitForResources({ baseDir: process.cwd(), files: ["missing-resource"], intervalMs: 10_000, timeoutMs: 20_000, tcpHost: "127.0.0.1", tcpPort: 65_534, signal: controller.signal }); process.exit(1); } catch (error) { process.exit(error?.name === "AbortError" ? 0 : 2); }`,
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe"] },
    );

    child.stdio[3].end();
    const [code, signal] = await NodeEvents.once(child, "exit");
    expect(code).toBe(0);
    expect(signal).toBe(null);
  });
});
