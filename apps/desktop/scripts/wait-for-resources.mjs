import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";

const defaultTcpHosts = ["127.0.0.1", "localhost", "::1"];

async function fileExists(filePath) {
  try {
    await NodeFSP.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function tcpPortIsReady({ host, port, connectTimeoutMs = 500, signal }) {
  return new Promise((resolveReady) => {
    const socket = NodeNet.createConnection({ host, port });
    let settled = false;

    const finish = (ready) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolveReady(ready);
    };

    const onAbort = () => finish(false);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    socket.once("connect", () => {
      finish(true);
    });
    socket.once("timeout", () => {
      finish(false);
    });
    socket.once("error", () => {
      finish(false);
    });
    socket.setTimeout(connectTimeoutMs);
  });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Waiting for desktop dev resources was aborted");
  error.name = "AbortError";
  throw error;
}

async function resolvePendingResources({
  baseDir,
  files,
  tcpPort,
  tcpHosts,
  connectTimeoutMs,
  signal,
}) {
  const pendingFiles = [];

  for (const relativeFilePath of files) {
    throwIfAborted(signal);
    const ready = await fileExists(NodePath.resolve(baseDir, relativeFilePath));
    throwIfAborted(signal);
    if (!ready) {
      pendingFiles.push(relativeFilePath);
    }
  }

  let tcpReady = false;
  for (const host of tcpHosts) {
    throwIfAborted(signal);
    tcpReady = await tcpPortIsReady({
      host,
      port: tcpPort,
      connectTimeoutMs,
      signal,
    });
    throwIfAborted(signal);
    if (tcpReady) {
      break;
    }
  }

  return {
    pendingFiles,
    tcpReady,
  };
}

export async function waitForResources({
  baseDir,
  files = [],
  intervalMs = 100,
  timeoutMs = 120_000,
  tcpHost,
  tcpPort,
  connectTimeoutMs = 500,
  signal,
}) {
  if (!Number.isInteger(tcpPort) || tcpPort <= 0) {
    throw new TypeError("waitForResources requires a positive integer tcpPort");
  }

  const startedAt = Date.now();
  const tcpHosts = tcpHost ? [tcpHost] : defaultTcpHosts;

  while (true) {
    throwIfAborted(signal);
    const { pendingFiles, tcpReady } = await resolvePendingResources({
      baseDir,
      files,
      tcpPort,
      tcpHosts,
      connectTimeoutMs,
      signal,
    });

    if (pendingFiles.length === 0 && tcpReady) {
      return;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      const pendingResources = [];
      if (!tcpReady) {
        pendingResources.push(tcpHost ? `tcp:${tcpHost}:${tcpPort}` : `tcp:${tcpPort}`);
      }
      for (const filePath of pendingFiles) {
        pendingResources.push(`file:${filePath}`);
      }

      throw new Error(
        `Timed out waiting for desktop dev resources after ${timeoutMs}ms: ${pendingResources.join(", ")}`,
      );
    }

    await NodeTimersPromises.setTimeout(intervalMs, undefined, { signal });
  }
}
