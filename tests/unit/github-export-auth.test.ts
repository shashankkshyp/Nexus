import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock @clerk/nextjs/server auth
let mockUserId: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: mockUserId,
  })),
}));

// Mock inngest
const mockInngestSend = vi.fn();
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: (args: unknown) => mockInngestSend(args),
  },
}));

// Mock convex
const mockConvexQuery = vi.fn();
const mockConvexMutation = vi.fn();
vi.mock("@/lib/convex-client", () => ({
  convex: {
    query: (...args: unknown[]) => mockConvexQuery(...args),
    mutation: (...args: unknown[]) => mockConvexMutation(...args),
  },
}));

import { POST as cancelExport } from "@/app/api/github/export/cancel/route";
import { POST as resetExport } from "@/app/api/github/export/reset/route";

describe("GitHub Export Endpoints Authorization", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, NEXUS_CONVEX_INTERNAL_KEY: "test-internal-key" };
    mockUserId = "user_owner_123";
    mockInngestSend.mockResolvedValue({ ids: ["event_cancel_123"] });
    mockConvexMutation.mockResolvedValue(undefined);
  });

  describe("POST /api/github/export/cancel", () => {
    it("returns 401 when unauthenticated", async () => {
      mockUserId = null;

      const request = new Request("http://localhost:3000/api/github/export/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj_123" }),
      });

      const response = await cancelExport(request);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it("returns 400 when body is invalid JSON", async () => {
      const request = new Request("http://localhost:3000/api/github/export/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid-json",
      });

      const response = await cancelExport(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({ error: "Invalid JSON body" });
    });

    it("returns 400 when projectId is missing", async () => {
      const request = new Request("http://localhost:3000/api/github/export/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await cancelExport(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({ error: "Invalid request body" });
    });

    it("returns 500 when NEXUS_CONVEX_INTERNAL_KEY is not configured", async () => {
      delete process.env.NEXUS_CONVEX_INTERNAL_KEY;

      const request = new Request("http://localhost:3000/api/github/export/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj_123" }),
      });

      const response = await cancelExport(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({ error: "Server configuration error" });
    });

    it("returns 404 when project is not found", async () => {
      mockConvexQuery.mockResolvedValue(null);

      const request = new Request("http://localhost:3000/api/github/export/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "non_existent_proj" }),
      });

      const response = await cancelExport(request);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({ error: "Project not found" });
      expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it("returns 403 when user is not the project owner", async () => {
      mockConvexQuery.mockResolvedValue({
        _id: "proj_123",
        ownerId: "different_user",
        name: "My Project",
      });

      const request = new Request("http://localhost:3000/api/github/export/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj_123" }),
      });

      const response = await cancelExport(request);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockInngestSend).not.toHaveBeenCalled();
      expect(mockConvexMutation).not.toHaveBeenCalled();
    });

    it("returns 200 and cancels export when user is project owner", async () => {
      mockConvexQuery.mockResolvedValue({
        _id: "proj_123",
        ownerId: "user_owner_123",
        name: "My Project",
      });

      const request = new Request("http://localhost:3000/api/github/export/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj_123" }),
      });

      const response = await cancelExport(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        projectId: "proj_123",
        eventId: "event_cancel_123",
      });
      expect(mockInngestSend).toHaveBeenCalledWith({
        name: "github/export.cancel",
        data: { projectId: "proj_123" },
      });
      expect(mockConvexMutation).toHaveBeenCalled();
    });
  });

  describe("POST /api/github/export/reset", () => {
    it("returns 401 when unauthenticated", async () => {
      mockUserId = null;

      const request = new Request("http://localhost:3000/api/github/export/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj_123" }),
      });

      const response = await resetExport(request);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
    });

    it("returns 400 when body is invalid JSON", async () => {
      const request = new Request("http://localhost:3000/api/github/export/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{malformed",
      });

      const response = await resetExport(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({ error: "Invalid JSON body" });
    });

    it("returns 400 when projectId is missing", async () => {
      const request = new Request("http://localhost:3000/api/github/export/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await resetExport(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({ error: "Invalid request body" });
    });

    it("returns 500 when NEXUS_CONVEX_INTERNAL_KEY is not configured", async () => {
      delete process.env.NEXUS_CONVEX_INTERNAL_KEY;

      const request = new Request("http://localhost:3000/api/github/export/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj_123" }),
      });

      const response = await resetExport(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({ error: "Server configuration error" });
    });

    it("returns 404 when project is not found", async () => {
      mockConvexQuery.mockResolvedValue(null);

      const request = new Request("http://localhost:3000/api/github/export/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "non_existent_proj" }),
      });

      const response = await resetExport(request);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({ error: "Project not found" });
    });

    it("returns 403 when user is not the project owner", async () => {
      mockConvexQuery.mockResolvedValue({
        _id: "proj_123",
        ownerId: "different_user",
        name: "My Project",
      });

      const request = new Request("http://localhost:3000/api/github/export/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj_123" }),
      });

      const response = await resetExport(request);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockConvexMutation).not.toHaveBeenCalled();
    });

    it("returns 200 and resets export status when user is project owner", async () => {
      mockConvexQuery.mockResolvedValue({
        _id: "proj_123",
        ownerId: "user_owner_123",
        name: "My Project",
      });

      const request = new Request("http://localhost:3000/api/github/export/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj_123" }),
      });

      const response = await resetExport(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        projectId: "proj_123",
      });
      expect(mockConvexMutation).toHaveBeenCalled();
    });
  });
});
