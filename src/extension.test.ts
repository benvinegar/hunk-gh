import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionCliCommand,
  ExtensionCliCommandContext,
  ExtensionCliCommandHandler,
  ExtensionEventHandler,
  HunkExtensionAPI,
} from "hunkdiff/extension";
import extensionEntry, { parseGitHubRepository } from "../index";
import { createGitHubPrExtension } from "./extension";
import type { GitHubFetch } from "./types";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Creates one test-owned temporary directory. */
function createTestDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "hunk-gh-extension-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** Captures the CLI command and shutdown handler registered by one factory. */
function registerTestExtension(extension = createGitHubPrExtension()) {
  const captured: {
    command?: ExtensionCliCommand;
    handler?: ExtensionCliCommandHandler;
    shutdown?: ExtensionEventHandler<"shutdown">;
  } = {};
  extension({
    registerCliCommand(command: ExtensionCliCommand, handler: ExtensionCliCommandHandler) {
      captured.command = command;
      captured.handler = handler;
    },
    on(event: string, handler: ExtensionEventHandler) {
      if (event === "shutdown") captured.shutdown = handler as ExtensionEventHandler<"shutdown">;
    },
  } as unknown as HunkExtensionAPI);
  return captured;
}

/** Creates a command context that records output without consuming stdin. */
function createTestContext(signal = new AbortController().signal) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let stdinReads = 0;
  const context = {
    cwd: "/repo",
    signal,
    stdin: {
      async *[Symbol.asyncIterator]() {
        stdinReads += 1;
        yield new Uint8Array();
      },
    },
    stdout: {
      async write(chunk: string | Uint8Array) {
        stdout.push(String(chunk));
      },
    },
    stderr: {
      async write(chunk: string | Uint8Array) {
        stderr.push(String(chunk));
      },
    },
  } satisfies ExtensionCliCommandContext;
  return { context, stdout, stderr, stdinReads: () => stdinReads };
}

describe("GitHub command dispatch", () => {
  test("loads through the tiny root entry point and preserves named exports", () => {
    expect(extensionEntry).toBeTypeOf("function");
    expect(parseGitHubRepository("modem-dev/hunk")).toEqual({
      owner: "modem-dev",
      repo: "hunk",
    });
  });

  test("registers the gh namespace and serves all help without I/O", async () => {
    let originReads = 0;
    let fetches = 0;
    const registration = registerTestExtension(
      createGitHubPrExtension({
        resolveOrigin: async () => {
          originReads += 1;
          return "";
        },
        fetchImpl: (async () => {
          fetches += 1;
          throw new Error("unexpected");
        }) as GitHubFetch,
      }),
    );
    expect(registration.command).toEqual({
      name: "gh",
      summary: "Review GitHub pull requests and commits",
      usage: "pr <number|owner/repo#number|pull-request-url> [--repo <owner/repo>]",
    });
    if (!registration.handler) throw new Error("Expected command registration.");

    for (const [args, usage] of [
      [["--help"], "Usage: hunk gh <command>"],
      [["pr", "--help"], "Usage: hunk gh pr"],
      [["commit", "--help"], "Usage: hunk gh commit"],
    ] as const) {
      const output = createTestContext();
      await expect(registration.handler(args, output.context)).resolves.toEqual({ kind: "exit" });
      expect(output.stdout.join("")).toContain(usage);
    }
    expect(originReads).toBe(0);
    expect(fetches).toBe(0);
  });

  test("rejects unknown GitHub subcommands", async () => {
    const registration = registerTestExtension();
    if (!registration.handler) throw new Error("Expected command registration.");
    await expect(registration.handler(["issue", "1"], createTestContext().context)).rejects.toThrow(
      "Unknown GitHub command",
    );
  });

  test.each([
    {
      args: ["pr", "123", "--", "--pager"],
      expectedUrl: "/pulls/123",
      expectedMessage: "pull request modem-dev/hunk#123",
      expectedFilename: "hunk-pr-123.diff",
    },
    {
      args: ["commit", "ABCDEF1", "--", "--pager"],
      expectedUrl: "/commits/abcdef1",
      expectedMessage: "commit modem-dev/hunk@abcdef1",
      expectedFilename: "hunk-commit-abcdef1.diff",
    },
  ])("fetches and delegates the $args[0] command", async (scenario) => {
    const temporaryRoot = createTestDirectory();
    const patch = "diff --git a/src/a.ts b/src/a.ts\n";
    let requestUrl = "";
    const registration = registerTestExtension(
      createGitHubPrExtension({
        temporaryRoot,
        env: {},
        fetchImpl: (async (url) => {
          requestUrl = String(url);
          return new Response(patch, { status: 200 });
        }) as GitHubFetch,
        resolveOrigin: async () => "git@github.com:modem-dev/hunk.git",
      }),
    );
    if (!registration.handler || !registration.shutdown) {
      throw new Error("Expected command and shutdown registrations.");
    }
    const output = createTestContext();
    const result = await registration.handler(scenario.args, output.context);
    if (result.kind !== "delegate") throw new Error("Expected patch delegation.");
    expect(requestUrl).toContain(scenario.expectedUrl);
    expect(result.argv[0]).toBe("patch");
    expect(result.argv[1]).toContain(scenario.expectedFilename);
    expect(result.argv.slice(2)).toEqual(["--pager"]);
    expect(readFileSync(result.argv[1]!, "utf8")).toBe(patch);
    expect(output.stdout).toEqual([]);
    expect(output.stdinReads()).toBe(0);
    expect(output.stderr.join("")).toContain(scenario.expectedMessage);
    await registration.shutdown({}, {} as never);
    expect(existsSync(result.argv[1]!)).toBe(false);
  });
});

describe("GitHub extension temporary patch lifecycle", () => {
  test("cancels after patch creation without returning a delegate", async () => {
    const temporaryRoot = createTestDirectory();
    const controller = new AbortController();
    const registration = registerTestExtension(
      createGitHubPrExtension({
        temporaryRoot,
        env: {},
        fetchImpl: (async () => new Response("diff --git a/a b/a\n")) as GitHubFetch,
      }),
    );
    if (!registration.handler) throw new Error("Expected command registration.");
    let stderrWrites = 0;
    const output = createTestContext(controller.signal);
    output.context.stderr.write = async () => {
      stderrWrites += 1;
      if (stderrWrites === 2) controller.abort();
    };
    await expect(
      registration.handler(["pr", "1", "--repo", "owner/repo"], output.context),
    ).rejects.toThrow("cancelled");
    expect(readdirSync(temporaryRoot)).toEqual([]);
  });

  test("retains patches while a replacement registry adopts the factory", async () => {
    const temporaryRoot = createTestDirectory();
    const extension = createGitHubPrExtension({
      temporaryRoot,
      env: {},
      fetchImpl: (async () => new Response("diff --git a/a b/a\n")) as GitHubFetch,
    });
    const first = registerTestExtension(extension);
    if (!first.handler || !first.shutdown) throw new Error("Expected first registration.");
    const result = await first.handler(
      ["pr", "1", "--repo", "owner/repo"],
      createTestContext().context,
    );
    if (result.kind !== "delegate") throw new Error("Expected patch delegation.");

    const replacement = registerTestExtension(extension);
    if (!replacement.shutdown) throw new Error("Expected replacement registration.");
    await first.shutdown({}, {} as never);
    expect(existsSync(result.argv[1]!)).toBe(true);
    await replacement.shutdown({}, {} as never);
    expect(existsSync(result.argv[1]!)).toBe(false);
  });

  test("declares a runtime-dependency-free API-v10 folder extension", () => {
    const sourceDirectory = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(
      readFileSync(join(sourceDirectory, "..", "package.json"), "utf8"),
    ) as {
      dependencies?: unknown;
      hunk?: { apiVersion?: number; extensions?: string[] };
    };
    expect(manifest.hunk).toEqual({ extensions: ["./index.ts"], apiVersion: 10 });
    expect(manifest.dependencies).toBeUndefined();
  });
});
