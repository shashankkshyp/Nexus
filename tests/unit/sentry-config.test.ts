import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Sentry Runtime Configuration (Issue #97)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Client runtime (src/instrumentation-client.ts)", () => {
    it("initializes Sentry when NEXT_PUBLIC_SENTRY_DSN is configured", async () => {
      process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@sentry.io/123";
      delete process.env.SENTRY_DSN;

      const initSpy = vi.fn();
      const replayIntegrationSpy = vi.fn().mockReturnValue({ name: "Replay" });
      const captureRouterTransitionStart = vi.fn();

      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        replayIntegration: replayIntegrationSpy,
        captureRouterTransitionStart,
      }));

      await import("../../src/instrumentation-client");

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(initSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: "https://public@sentry.io/123",
          tracesSampleRate: 1,
          enableLogs: true,
          replaysSessionSampleRate: 0.1,
          replaysOnErrorSampleRate: 1.0,
          sendDefaultPii: true,
          integrations: expect.arrayContaining([expect.objectContaining({ name: "Replay" })]),
        }),
      );
    });

    it("does not initialize Sentry when NEXT_PUBLIC_SENTRY_DSN is unset", async () => {
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;
      delete process.env.SENTRY_DSN;

      const initSpy = vi.fn();
      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        replayIntegration: vi.fn(),
        captureRouterTransitionStart: vi.fn(),
      }));

      await import("../../src/instrumentation-client");

      expect(initSpy).not.toHaveBeenCalled();
    });

    it("does not initialize Sentry when NEXT_PUBLIC_SENTRY_DSN is empty string", async () => {
      process.env.NEXT_PUBLIC_SENTRY_DSN = "";
      delete process.env.SENTRY_DSN;

      const initSpy = vi.fn();
      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        replayIntegration: vi.fn(),
        captureRouterTransitionStart: vi.fn(),
      }));

      await import("../../src/instrumentation-client");

      expect(initSpy).not.toHaveBeenCalled();
    });

    it("does not read SENTRY_DSN or initialize if only SENTRY_DSN is set", async () => {
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;
      process.env.SENTRY_DSN = "https://server-secret@sentry.io/456";

      const initSpy = vi.fn();
      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        replayIntegration: vi.fn(),
        captureRouterTransitionStart: vi.fn(),
      }));

      await import("../../src/instrumentation-client");

      expect(initSpy).not.toHaveBeenCalled();
    });
  });

  describe("Server runtime (sentry.server.config.ts)", () => {
    it("initializes Sentry when SENTRY_DSN is configured", async () => {
      process.env.SENTRY_DSN = "https://server@sentry.io/456";
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;

      const initSpy = vi.fn();
      const vercelAISpy = vi.fn().mockReturnValue({ name: "VercelAI" });
      const consoleLoggingSpy = vi.fn().mockReturnValue({ name: "ConsoleLogging" });

      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        vercelAIIntegration: vercelAISpy,
        consoleLoggingIntegration: consoleLoggingSpy,
      }));

      await import("../../sentry.server.config");

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(initSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: "https://server@sentry.io/456",
          tracesSampleRate: 1,
          enableLogs: true,
          sendDefaultPii: true,
          integrations: expect.arrayContaining([
            expect.objectContaining({ name: "VercelAI" }),
            expect.objectContaining({ name: "ConsoleLogging" }),
          ]),
        }),
      );
    });

    it("does not initialize Sentry when SENTRY_DSN is unset", async () => {
      delete process.env.SENTRY_DSN;

      const initSpy = vi.fn();
      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        vercelAIIntegration: vi.fn(),
        consoleLoggingIntegration: vi.fn(),
      }));

      await import("../../sentry.server.config");

      expect(initSpy).not.toHaveBeenCalled();
    });

    it("does not initialize Sentry when SENTRY_DSN is empty string", async () => {
      process.env.SENTRY_DSN = "";

      const initSpy = vi.fn();
      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        vercelAIIntegration: vi.fn(),
        consoleLoggingIntegration: vi.fn(),
      }));

      await import("../../sentry.server.config");

      expect(initSpy).not.toHaveBeenCalled();
    });
  });

  describe("Edge runtime (sentry.edge.config.ts)", () => {
    it("initializes Sentry when SENTRY_DSN is configured", async () => {
      process.env.SENTRY_DSN = "https://edge@sentry.io/789";
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;

      const initSpy = vi.fn();
      const vercelAISpy = vi.fn().mockReturnValue({ name: "VercelAI" });
      const consoleLoggingSpy = vi.fn().mockReturnValue({ name: "ConsoleLogging" });

      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        vercelAIIntegration: vercelAISpy,
        consoleLoggingIntegration: consoleLoggingSpy,
      }));

      await import("../../sentry.edge.config");

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(initSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: "https://edge@sentry.io/789",
          tracesSampleRate: 1,
          enableLogs: true,
          sendDefaultPii: true,
          integrations: expect.arrayContaining([
            expect.objectContaining({ name: "VercelAI" }),
            expect.objectContaining({ name: "ConsoleLogging" }),
          ]),
        }),
      );
    });

    it("does not initialize Sentry when SENTRY_DSN is unset", async () => {
      delete process.env.SENTRY_DSN;

      const initSpy = vi.fn();
      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        vercelAIIntegration: vi.fn(),
        consoleLoggingIntegration: vi.fn(),
      }));

      await import("../../sentry.edge.config");

      expect(initSpy).not.toHaveBeenCalled();
    });

    it("does not initialize Sentry when SENTRY_DSN is empty string", async () => {
      process.env.SENTRY_DSN = "";

      const initSpy = vi.fn();
      vi.doMock("@sentry/nextjs", () => ({
        init: initSpy,
        vercelAIIntegration: vi.fn(),
        consoleLoggingIntegration: vi.fn(),
      }));

      await import("../../sentry.edge.config");

      expect(initSpy).not.toHaveBeenCalled();
    });
  });

  describe("Configuration and secret isolation", () => {
    it("ensures client code does not reference SENTRY_DSN", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const clientContent = fs.readFileSync(
        path.resolve(process.cwd(), "src/instrumentation-client.ts"),
        "utf-8",
      );

      // Verify NEXT_PUBLIC_SENTRY_DSN is present
      expect(clientContent).toContain("process.env.NEXT_PUBLIC_SENTRY_DSN");

      // Verify SENTRY_DSN is not referenced without NEXT_PUBLIC_ prefix
      const stripped = clientContent.replace(/process\.env\.NEXT_PUBLIC_SENTRY_DSN/g, "");
      expect(stripped).not.toContain("SENTRY_DSN");
    });

    it("ensures no hardcoded sentry ingest URLs remain in config files", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const files = [
        "src/instrumentation-client.ts",
        "sentry.server.config.ts",
        "sentry.edge.config.ts",
      ];

      for (const file of files) {
        const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
        expect(content).not.toContain("ingest.us.sentry.io");
        expect(content).not.toContain("ingest.sentry.io");
        expect(content).not.toContain("a4c5d6afe3adc8c5c6b48b262c4383c7");
      }
    });
  });
});
