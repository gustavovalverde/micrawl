import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * CLI Integration Test
 *
 * Exercises the CLI via stdin/stdout to ensure the MCP protocol handshake and
 * tool execution work correctly. The test boots the TypeScript entrypoint with
 * the tsx loader so it can run against a clean checkout without requiring a
 * prior build.
 */
describe("MCP CLI stdio transport", () => {
  let tempRoot: string;
  const cliEntrypoint = resolve(__dirname, "../src/stdio.ts");
  const tsxBin = resolve(
    __dirname,
    `../node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`,
  );

  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "micrawl-cli-"));
  });

  afterAll(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  const createCli = (): {
    process: ChildProcess;
    send: (message: unknown) => void;
    receive: () => Promise<unknown>;
    close: () => Promise<void>;
  } => {
    const proc = spawn(tsxBin, [cliEntrypoint], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    });

    const lineBuffer: string[] = [];
    let resolveNext: ((value: unknown) => void) | null = null;

    proc.stdout?.on("data", (chunk) => {
      const lines = chunk
        .toString()
        .split("\n")
        .filter((line: string) => line.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (resolveNext) {
            resolveNext(parsed);
            resolveNext = null;
          } else {
            lineBuffer.push(line);
          }
        } catch {
          // Ignore non-JSON output (logs, etc.)
        }
      }
    });

    const send = (message: unknown) => {
      proc.stdin?.write(`${JSON.stringify(message)}\n`);
    };

    const receive = (): Promise<unknown> => {
      if (lineBuffer.length > 0) {
        const buffered = lineBuffer.shift();
        if (buffered !== undefined) {
          return Promise.resolve(JSON.parse(buffered));
        }
        return Promise.reject(new Error("Buffered line missing"));
      }
      return new Promise((resolve) => {
        resolveNext = resolve;
      });
    };

    const close = async (): Promise<void> => {
      proc.kill("SIGTERM");
      return new Promise((resolve) => {
        proc.on("exit", () => resolve());
      });
    };

    return { process: proc, send, receive, close };
  };

  it("responds to MCP initialize request", async () => {
    const cli = createCli();

    cli.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      },
    });

    const response = await cli.receive();

    expect(response).toHaveProperty("jsonrpc", "2.0");
    expect(response).toHaveProperty("id", 1);
    expect(response).toHaveProperty("result");

    const result = (
      response as {
        result: { capabilities: unknown; serverInfo: { name: string } };
      }
    ).result;
    expect(result.serverInfo.name).toBe("micrawl-mcp");
    expect(result.capabilities).toHaveProperty("tools");

    await cli.close();
  }, 10000);

  it("lists available tools via tools/list", async () => {
    const cli = createCli();

    // Initialize first
    cli.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    await cli.receive();

    // Send initialized notification
    cli.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    // List tools
    cli.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    const response = await cli.receive();

    expect(response).toHaveProperty("jsonrpc", "2.0");
    expect(response).toHaveProperty("id", 2);
    expect(response).toHaveProperty("result");

    const result = (response as { result: { tools: Array<{ name: string }> } })
      .result;
    const toolNames = result.tools.map((tool) => tool.name);

    expect(toolNames).toContain("fetch_page");
    expect(toolNames).toContain("save_docs");
    expect(toolNames).toHaveLength(2);

    await cli.close();
  }, 10000);

  it("handles invalid JSON-RPC messages gracefully", async () => {
    const cli = createCli();
    const errors: string[] = [];

    cli.process.stderr?.on("data", (chunk) => {
      errors.push(chunk.toString());
    });

    // Send malformed JSON
    cli.process.stdin?.write("not-json\n");

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Server should still be running - send valid request
    cli.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    const response = await cli.receive();
    expect(response).toHaveProperty("jsonrpc", "2.0");
    expect(response).toHaveProperty("id", 1);

    await cli.close();
  }, 10000);
});
