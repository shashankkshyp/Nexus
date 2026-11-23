import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";

const cjsRequire = createRequire(import.meta.url);

interface MockDoc {
  _id: string;
  [key: string]: unknown;
}

interface ConvexMutationHandler {
  handler: (ctx: unknown, args: { conversationId: string }) => Promise<{ success: boolean }>;
}

// In-memory Convex state for testing
let mockUser: { subject: string } | null = null;
let mockDb: Record<string, Map<string, Record<string, unknown>>> = {
  projects: new Map(),
  conversations: new Map(),
  messages: new Map(),
  executionEvents: new Map(),
};

function resetDb() {
  mockUser = null;
  mockDb = {
    projects: new Map(),
    conversations: new Map(),
    messages: new Map(),
    executionEvents: new Map(),
  };
}

function loadConvexConversationsModule(): { deleteConversation: ConvexMutationHandler } {
  const fullPath = path.resolve(process.cwd(), "convex/conversations.ts");
  const tsCode = fs.readFileSync(fullPath, "utf-8");
  const transpiled = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const m: { exports: { deleteConversation: ConvexMutationHandler } } = {
    exports: { deleteConversation: { handler: async () => ({ success: true }) } },
  };

  const customRequire = (id: string) => {
    if (id === "./_generated/server") {
      return {
        mutation: (config: unknown) => config,
        query: (config: unknown) => config,
      };
    }
    if (id === "convex/values") {
      return {
        v: {
          id: (tableName: string) => ({ type: "id", tableName }),
          string: () => ({ type: "string" }),
          number: () => ({ type: "number" }),
          optional: (inner: unknown) => ({ type: "optional", inner }),
          object: (fields: unknown) => ({ type: "object", fields }),
          union: (...types: unknown[]) => ({ type: "union", types }),
          literal: (val: unknown) => ({ type: "literal", val }),
        },
      };
    }
    if (id === "./auth") {
      return {
        verifyAuth: async (ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) => {
          const identity = await ctx.auth.getUserIdentity();
          if (!identity) throw new Error("Unauthorized");
          return identity;
        },
      };
    }
    return cjsRequire(id);
  };

  const fn = new Function("require", "module", "exports", transpiled);
  fn(customRequire, m, m.exports);
  return m.exports;
}

function createMockCtx() {
  return {
    auth: {
      getUserIdentity: async () => mockUser,
    },
    db: {
      get: async (tableOrId: string, maybeId?: string) => {
        const id = maybeId !== undefined ? maybeId : tableOrId;
        for (const tableName of Object.keys(mockDb)) {
          const table = mockDb[tableName];
          if (table && table.has(id)) {
            return { _id: id, ...table.get(id) };
          }
        }
        return null;
      },
      delete: async (tableOrId: string, maybeId?: string) => {
        const id = maybeId !== undefined ? maybeId : tableOrId;
        const tableName = maybeId !== undefined ? tableOrId : id.split("_")[0];
        const table = mockDb[tableName];
        if (table) {
          table.delete(id);
        }
      },
      query: (tableName: string) => {
        const table = mockDb[tableName];
        const items: MockDoc[] = table
          ? Array.from(table.entries()).map(([id, doc]) => ({
              _id: id,
              ...doc,
            }))
          : [];

        return {
          withIndex: (
            _indexName: string,
            filterFn: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const conditions: Array<{ field: string; value: unknown }> = [];
            const q = {
              eq: (field: string, value: unknown) => {
                conditions.push({ field, value });
                return q;
              },
            };
            filterFn(q);

            return {
              collect: async () => {
                return items.filter((item) =>
                  conditions.every((c) => item[c.field] === c.value),
                );
              },
            };
          },
        };
      },
    },
  };
}

describe("convex/conversations.ts: deleteConversation mutation", () => {
  let conversationsModule: { deleteConversation: ConvexMutationHandler };

  beforeEach(() => {
    resetDb();
    conversationsModule = loadConvexConversationsModule();
  });

  test("1. Authenticated project owner can delete a conversation", async () => {
    mockUser = { subject: "user_owner" };

    mockDb.projects.set("proj_1", { ownerId: "user_owner", name: "Project 1" });
    mockDb.conversations.set("conv_1", { projectId: "proj_1", title: "Conv 1" });

    const ctx = createMockCtx();
    const result = await conversationsModule.deleteConversation.handler(ctx, {
      conversationId: "conv_1",
    });

    assert.deepEqual(result, { success: true });
    assert.equal(mockDb.conversations.has("conv_1"), false);
  });

  test("2. Unauthenticated user cannot delete a conversation", async () => {
    mockUser = null;

    mockDb.projects.set("proj_1", { ownerId: "user_owner", name: "Project 1" });
    mockDb.conversations.set("conv_1", { projectId: "proj_1", title: "Conv 1" });

    const ctx = createMockCtx();
    await assert.rejects(
      async () => {
        await conversationsModule.deleteConversation.handler(ctx, {
          conversationId: "conv_1",
        });
      },
      { message: "Unauthorized" },
    );

    // State remains untouched
    assert.equal(mockDb.conversations.has("conv_1"), true);
  });

  test("3. Non-owner cannot delete another user's conversation", async () => {
    mockUser = { subject: "user_other" };

    mockDb.projects.set("proj_1", { ownerId: "user_owner", name: "Project 1" });
    mockDb.conversations.set("conv_1", { projectId: "proj_1", title: "Conv 1" });

    const ctx = createMockCtx();
    await assert.rejects(
      async () => {
        await conversationsModule.deleteConversation.handler(ctx, {
          conversationId: "conv_1",
        });
      },
      { message: "Unauthorized to access this project" },
    );

    assert.equal(mockDb.conversations.has("conv_1"), true);
  });

  test("4. Missing conversation throws appropriate error", async () => {
    mockUser = { subject: "user_owner" };

    const ctx = createMockCtx();
    await assert.rejects(
      async () => {
        await conversationsModule.deleteConversation.handler(ctx, {
          conversationId: "nonexistent_conv",
        });
      },
      { message: "Conversation not found" },
    );
  });

  test("5. Missing parent project throws appropriate error", async () => {
    mockUser = { subject: "user_owner" };
    mockDb.conversations.set("conv_1", { projectId: "orphan_project", title: "Conv 1" });

    const ctx = createMockCtx();
    await assert.rejects(
      async () => {
        await conversationsModule.deleteConversation.handler(ctx, {
          conversationId: "conv_1",
        });
      },
      { message: "Project not found" },
    );
  });

  test("6 & 8. Deletes all associated messages while preserving messages from other conversations", async () => {
    mockUser = { subject: "user_owner" };

    mockDb.projects.set("proj_1", { ownerId: "user_owner", name: "Project 1" });
    mockDb.conversations.set("conv_1", { projectId: "proj_1", title: "Conv 1" });
    mockDb.conversations.set("conv_2", { projectId: "proj_1", title: "Conv 2" });

    mockDb.messages.set("msg_1", { conversationId: "conv_1", content: "Hello conv 1" });
    mockDb.messages.set("msg_2", { conversationId: "conv_1", content: "World conv 1" });
    mockDb.messages.set("msg_3", { conversationId: "conv_2", content: "Stay conv 2" });

    const ctx = createMockCtx();
    await conversationsModule.deleteConversation.handler(ctx, {
      conversationId: "conv_1",
    });

    assert.equal(mockDb.conversations.has("conv_1"), false);
    assert.equal(mockDb.messages.has("msg_1"), false);
    assert.equal(mockDb.messages.has("msg_2"), false);
    assert.equal(mockDb.messages.has("msg_3"), true);
  });

  test("7 & 9. Deletes all associated execution events while preserving events from other conversations", async () => {
    mockUser = { subject: "user_owner" };

    mockDb.projects.set("proj_1", { ownerId: "user_owner", name: "Project 1" });
    mockDb.conversations.set("conv_1", { projectId: "proj_1", title: "Conv 1" });
    mockDb.conversations.set("conv_2", { projectId: "proj_1", title: "Conv 2" });

    mockDb.executionEvents.set("evt_1", { conversationId: "conv_1", eventType: "tool_start" });
    mockDb.executionEvents.set("evt_2", { conversationId: "conv_1", eventType: "tool_complete" });
    mockDb.executionEvents.set("evt_3", { conversationId: "conv_2", eventType: "tool_start" });

    const ctx = createMockCtx();
    await conversationsModule.deleteConversation.handler(ctx, {
      conversationId: "conv_1",
    });

    assert.equal(mockDb.executionEvents.has("evt_1"), false);
    assert.equal(mockDb.executionEvents.has("evt_2"), false);
    assert.equal(mockDb.executionEvents.has("evt_3"), true);
  });
});
