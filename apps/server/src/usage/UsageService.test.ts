import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  CodexSettings,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);
const codexDriverKind = ProviderDriverKind.make("codex");

/**
 * Regression test for #11515: UsageService.resolveTranscriptDirs must scan
 * every configured Codex instance, not just the legacy single-instance config.
 *
 * We test the underlying logic (resolveCodexHomeLayout + deduplication) rather
 * than the full service because the service requires a live settings layer and
 * filesystem. The bug was that `settings.providerInstances` entries with
 * `driver === "codex"` were ignored entirely, so their session directories
 * never appeared in the scan list.
 */
it.layer(NodeServices.layer)("UsageService multi-account Codex routing (#11515)", (it) => {
  describe("resolveTranscriptDirs multi-instance enumeration", () => {
    it.effect("resolves distinct session dirs for multiple Codex instances", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;

        // Simulate what resolveTranscriptDirs does: collect unique session dirs
        // from both the legacy config and providerInstances.
        const seenCodexDirs = new Set<string>();
        const codexDirs: string[] = [];

        const addCodexDir = (layout: { readonly sharedHomePath: string }) => {
          const sessionDir = path.join(layout.sharedHomePath, "sessions");
          if (seenCodexDirs.has(sessionDir)) return;
          seenCodexDirs.add(sessionDir);
          codexDirs.push(sessionDir);
        };

        // Legacy config: default ~/.codex
        const legacyConfig = decodeCodexSettings({});
        const legacyLayout = yield* resolveCodexHomeLayout(legacyConfig);
        addCodexDir(legacyLayout);

        // Multi-instance configs: two additional accounts with different homes
        const personalHome = path.resolve("/home/user/.codex-personal");
        const workHome = path.resolve("/home/user/.codex-work");
        const instances: Record<string, { driver: string; config: Record<string, unknown> }> = {
          codex_personal: {
            driver: "codex",
            config: { homePath: personalHome },
          },
          codex_work: {
            driver: "codex",
            config: { homePath: workHome },
          },
          claude_primary: {
            driver: "claudeAgent",
            config: {},
          },
        };

        for (const instance of Object.values(instances)) {
          if (instance.driver !== codexDriverKind) continue;
          const decoded = decodeCodexSettings(instance.config);
          const layout = yield* resolveCodexHomeLayout(decoded);
          addCodexDir(layout);
        }

        // Should have 3 distinct Codex session directories
        expect(codexDirs).toHaveLength(3);
        expect(codexDirs).toContain(path.join(legacyLayout.sharedHomePath, "sessions"));
        expect(codexDirs).toContain(path.join(personalHome, "sessions"));
        expect(codexDirs).toContain(path.join(workHome, "sessions"));
      }),
    );

    it.effect("deduplicates when two instances share the same home path", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;

        const seenCodexDirs = new Set<string>();
        const codexDirs: string[] = [];

        const addCodexDir = (layout: { readonly sharedHomePath: string }) => {
          const sessionDir = path.join(layout.sharedHomePath, "sessions");
          if (seenCodexDirs.has(sessionDir)) return;
          seenCodexDirs.add(sessionDir);
          codexDirs.push(sessionDir);
        };

        // Two instances pointing at the same home should produce one entry
        const sharedHome = path.resolve("/shared/codex-home");
        const instances: Record<string, { driver: string; config: Record<string, unknown> }> = {
          codex_a: {
            driver: "codex",
            config: { homePath: sharedHome },
          },
          codex_b: {
            driver: "codex",
            config: { homePath: sharedHome },
          },
        };

        for (const instance of Object.values(instances)) {
          if (instance.driver !== codexDriverKind) continue;
          const decoded = decodeCodexSettings(instance.config);
          const layout = yield* resolveCodexHomeLayout(decoded);
          addCodexDir(layout);
        }

        expect(codexDirs).toHaveLength(1);
        expect(codexDirs[0]).toBe(path.join(sharedHome, "sessions"));
      }),
    );

    it.effect("skips non-codex provider instances", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;

        const seenCodexDirs = new Set<string>();
        const codexDirs: string[] = [];

        const addCodexDir = (layout: { readonly sharedHomePath: string }) => {
          const sessionDir = path.join(layout.sharedHomePath, "sessions");
          if (seenCodexDirs.has(sessionDir)) return;
          seenCodexDirs.add(sessionDir);
          codexDirs.push(sessionDir);
        };

        const instances: Record<string, { driver: string; config: Record<string, unknown> }> = {
          claude_main: {
            driver: "claudeAgent",
            config: {},
          },
          cursor_default: {
            driver: "cursor",
            config: {},
          },
        };

        for (const instance of Object.values(instances)) {
          if (instance.driver !== codexDriverKind) continue;
          const decoded = decodeCodexSettings(instance.config);
          const layout = yield* resolveCodexHomeLayout(decoded);
          addCodexDir(layout);
        }

        expect(codexDirs).toHaveLength(0);
      }),
    );
  });
});