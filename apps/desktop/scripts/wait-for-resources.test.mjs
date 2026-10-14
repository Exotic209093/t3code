import { describe, expect, it } from "vite-plus/test";

import { waitForResources } from "./wait-for-resources.mjs";

describe("waitForResources", () => {
  it("stops a pending readiness wait when its owner exits", async () => {
    const controller = new AbortController();
    const waiting = waitForResources({
      baseDir: import.meta.dirname,
      files: ["missing-resource"],
      intervalMs: 10_000,
      timeoutMs: 20_000,
      tcpHost: "127.0.0.1",
      tcpPort: 65_534,
      signal: controller.signal,
    });

    controller.abort();

    await expect(waiting).rejects.toThrow("aborted");
  });
});
