// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Polyfill ResizeObserver and scrollIntoView for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock hooks from use-conversations
const mockCreateConversation = vi.fn();
const mockRenameConversation = vi.fn();
const mockDeleteConversation = vi.fn();
let mockConversations: Array<{ _id: string; title: string; _creationTime: number }> = [
  { _id: "conv_1", title: "First Conversation", _creationTime: Date.now() - 60000 },
];

vi.mock("@/features/conversations/hooks/use-conversations", () => ({
  useConversation: () => ({ _id: "conv_1", title: "Active Conversation" }),
  useConversations: () => mockConversations,
  useCreateConversation: () => mockCreateConversation,
  useRenameConversation: () => mockRenameConversation,
  useDeleteConversation: () => mockDeleteConversation,
  useMessages: () => [],
  useExecutionEvents: () => [],
}));

// Mock toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { ConversationSidebar } from "@/features/conversations/components/conversation-sidebar";
import { Id } from "@/../convex/_generated/dataModel";

describe("ConversationSidebar header action buttons accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversations = [{ _id: "conv_1", title: "First Conversation", _creationTime: Date.now() - 60000 }];
  });

  it("Test 1 — Past Conversations accessible name", () => {
    render(<ConversationSidebar projectId={"proj_1" as Id<"projects">} />);

    const button = screen.getByRole("button", { name: "Past conversations" });
    expect(button).toBeDefined();
  });

  it("Test 2 — Past Conversations attributes (aria-label and title)", () => {
    render(<ConversationSidebar projectId={"proj_1" as Id<"projects">} />);

    const button = screen.getByRole("button", { name: "Past conversations" });
    expect(button.getAttribute("aria-label")).toBe("Past conversations");
    expect(button.getAttribute("title")).toBe("Past conversations");
  });

  it("Test 3 — New Conversation accessible name", () => {
    render(<ConversationSidebar projectId={"proj_1" as Id<"projects">} />);

    const button = screen.getByRole("button", { name: "New conversation" });
    expect(button).toBeDefined();
  });

  it("Test 4 — New Conversation attributes (aria-label and title)", () => {
    render(<ConversationSidebar projectId={"proj_1" as Id<"projects">} />);

    const button = screen.getByRole("button", { name: "New conversation" });
    expect(button.getAttribute("aria-label")).toBe("New conversation");
    expect(button.getAttribute("title")).toBe("New conversation");
  });

  it("Test 5 — Past Conversations click behavior opens dialog", () => {
    render(<ConversationSidebar projectId={"proj_1" as Id<"projects">} />);

    const button = screen.getByRole("button", { name: "Past conversations" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button);

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByPlaceholderText("Search conversations...")).toBeDefined();
  });

  it("Test 6 — New Conversation click behavior triggers createConversation", async () => {
    mockCreateConversation.mockResolvedValue("conv_new_123");

    render(<ConversationSidebar projectId={"proj_1" as Id<"projects">} />);

    const button = screen.getByRole("button", { name: "New conversation" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledTimes(1);
      expect(mockCreateConversation).toHaveBeenCalledWith({
        projectId: "proj_1",
        title: "New conversation",
      });
    });
  });

  it("Test 7 — Both buttons are independently discoverable without conflict", () => {
    render(<ConversationSidebar projectId={"proj_1" as Id<"projects">} />);

    const pastBtn = screen.getByRole("button", { name: "Past conversations" });
    const newBtn = screen.getByRole("button", { name: "New conversation" });

    expect(pastBtn).not.toBe(newBtn);
    expect(pastBtn.getAttribute("aria-label")).toBe("Past conversations");
    expect(newBtn.getAttribute("aria-label")).toBe("New conversation");
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { toast } from "sonner";
import { PastConversationsDialog } from "@/features/conversations/components/past-conversations-dialog";

describe("Convex rename mutation logic (Issue #67)", () => {
  let renameMutationHandler: any;
  let mockDb: {
    conversations: Map<string, any>;
    projects: Map<string, any>;
    messages: Map<string, any>;
  };
  let mockUser: { subject: string } | null;

  beforeEach(() => {
    mockDb = {
      conversations: new Map(),
      projects: new Map(),
      messages: new Map(),
    };
    mockUser = { subject: "user_owner" };

    const fullPath = path.resolve(process.cwd(), "convex/conversations.ts");
    const tsCode = fs.readFileSync(fullPath, "utf-8");
    const transpiled = ts.transpileModule(tsCode, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;

    const customRequire = (id: string) => {
      if (id === "./_generated/server") {
        return {
          mutation: (config: any) => config,
          query: (config: any) => config,
        };
      }
      if (id === "convex/values") {
        return {
          v: {
            id: (t: string) => ({ type: "id", t }),
            string: () => ({ type: "string" }),
          },
        };
      }
      if (id === "./auth") {
        return {
          verifyAuth: async () => {
            if (!mockUser) {
              throw new Error("Unauthorized");
            }
            return mockUser;
          },
        };
      }
      return require(id);
    };

    const m = { exports: {} as any };
    const fn = new Function("require", "exports", "module", transpiled);
    fn(customRequire, m.exports, m);
    renameMutationHandler = m.exports.rename.handler;
  });

  const createCtx = () => ({
    db: {
      get: async (table: string, id: string) => {
        return (mockDb as any)[table]?.get(id) || null;
      },
      patch: async (table: string, id: string, fields: any) => {
        const existing = (mockDb as any)[table]?.get(id);
        if (!existing) throw new Error("Document not found to patch");
        const updated = { ...existing, ...fields };
        (mockDb as any)[table]?.set(id, updated);
        return updated;
      },
    },
  });

  it("1. Authenticated project owner successfully renames a conversation", async () => {
    mockDb.projects.set("proj_1", { _id: "proj_1", ownerId: "user_owner" });
    mockDb.conversations.set("conv_1", {
      _id: "conv_1",
      projectId: "proj_1",
      title: "Initial Title",
      updatedAt: 100,
    });

    const ctx = createCtx();
    const result = await renameMutationHandler(ctx, {
      conversationId: "conv_1",
      title: "Updated Title",
    });

    expect(result).toBe("conv_1");
    const updated = mockDb.conversations.get("conv_1");
    expect(updated.title).toBe("Updated Title");
    expect(updated.updatedAt).toBeGreaterThan(100);
  });

  it("2. New title is trimmed before persistence", async () => {
    mockDb.projects.set("proj_1", { _id: "proj_1", ownerId: "user_owner" });
    mockDb.conversations.set("conv_1", {
      _id: "conv_1",
      projectId: "proj_1",
      title: "Initial Title",
      updatedAt: 100,
    });

    const ctx = createCtx();
    await renameMutationHandler(ctx, {
      conversationId: "conv_1",
      title: "   Trimmed Title With Spaces Inside   ",
    });

    const updated = mockDb.conversations.get("conv_1");
    expect(updated.title).toBe("Trimmed Title With Spaces Inside");
  });

  it("3. Empty title is rejected", async () => {
    mockDb.projects.set("proj_1", { _id: "proj_1", ownerId: "user_owner" });
    mockDb.conversations.set("conv_1", {
      _id: "conv_1",
      projectId: "proj_1",
      title: "Initial Title",
      updatedAt: 100,
    });

    const ctx = createCtx();
    await expect(
      renameMutationHandler(ctx, {
        conversationId: "conv_1",
        title: "",
      }),
    ).rejects.toThrow("Conversation title cannot be empty");

    expect(mockDb.conversations.get("conv_1").title).toBe("Initial Title");
  });

  it("4. Whitespace-only title is rejected", async () => {
    mockDb.projects.set("proj_1", { _id: "proj_1", ownerId: "user_owner" });
    mockDb.conversations.set("conv_1", {
      _id: "conv_1",
      projectId: "proj_1",
      title: "Initial Title",
      updatedAt: 100,
    });

    const ctx = createCtx();
    await expect(
      renameMutationHandler(ctx, {
        conversationId: "conv_1",
        title: "   \t\n   ",
      }),
    ).rejects.toThrow("Conversation title cannot be empty");

    expect(mockDb.conversations.get("conv_1").title).toBe("Initial Title");
  });

  it("5. Missing conversation is rejected", async () => {
    mockDb.projects.set("proj_1", { _id: "proj_1", ownerId: "user_owner" });

    const ctx = createCtx();
    await expect(
      renameMutationHandler(ctx, {
        conversationId: "non_existent_conv",
        title: "New Title",
      }),
    ).rejects.toThrow("Conversation not found");
  });

  it("6. Missing parent project is rejected", async () => {
    mockDb.conversations.set("conv_1", {
      _id: "conv_1",
      projectId: "missing_proj",
      title: "Initial Title",
      updatedAt: 100,
    });

    const ctx = createCtx();
    await expect(
      renameMutationHandler(ctx, {
        conversationId: "conv_1",
        title: "New Title",
      }),
    ).rejects.toThrow("Project not found");
  });

  it("7. Unauthorized user cannot rename another user's conversation", async () => {
    mockDb.projects.set("proj_1", { _id: "proj_1", ownerId: "user_other" });
    mockDb.conversations.set("conv_1", {
      _id: "conv_1",
      projectId: "proj_1",
      title: "Initial Title",
      updatedAt: 100,
    });

    const ctx = createCtx();
    await expect(
      renameMutationHandler(ctx, {
        conversationId: "conv_1",
        title: "New Title",
      }),
    ).rejects.toThrow("Unauthorized to access this project");

    expect(mockDb.conversations.get("conv_1").title).toBe("Initial Title");
  });

  it("8. Unauthenticated caller is rejected", async () => {
    mockUser = null;
    mockDb.projects.set("proj_1", { _id: "proj_1", ownerId: "user_owner" });
    mockDb.conversations.set("conv_1", {
      _id: "conv_1",
      projectId: "proj_1",
      title: "Initial Title",
      updatedAt: 100,
    });

    const ctx = createCtx();
    await expect(
      renameMutationHandler(ctx, {
        conversationId: "conv_1",
        title: "New Title",
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("9. Renaming preserves conversation ID and does not modify associated messages", async () => {
    mockDb.projects.set("proj_1", { _id: "proj_1", ownerId: "user_owner" });
    mockDb.conversations.set("conv_1", {
      _id: "conv_1",
      projectId: "proj_1",
      title: "Initial Title",
      updatedAt: 100,
    });
    mockDb.messages.set("msg_1", {
      _id: "msg_1",
      conversationId: "conv_1",
      content: "Hello",
    });

    const ctx = createCtx();
    const result = await renameMutationHandler(ctx, {
      conversationId: "conv_1",
      title: "Brand New Title",
    });

    expect(result).toBe("conv_1");
    expect(mockDb.conversations.get("conv_1")._id).toBe("conv_1");
    expect(mockDb.messages.get("msg_1").content).toBe("Hello");
  });
});

describe("PastConversationsDialog - Rename UI and Accessibility (Issue #67)", () => {
  const projectId = "proj_1" as Id<"projects">;
  const mockOnSelect = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockConversations = [
      {
        _id: "conv_1",
        title: "First Conversation",
        _creationTime: Date.now() - 60000,
      },
      {
        _id: "conv_2",
        title: "Second Conversation",
        _creationTime: Date.now() - 120000,
      },
    ];
  });

  it("renders accessible rename action for each conversation", () => {
    render(
      <PastConversationsDialog
        projectId={projectId}
        open={true}
        onOpenChange={mockOnOpenChange}
        onSelect={mockOnSelect}
      />,
    );

    const renameBtn1 = screen.getByRole("button", {
      name: "Rename First Conversation",
    });
    const renameBtn2 = screen.getByRole("button", {
      name: "Rename Second Conversation",
    });

    expect(renameBtn1).toBeDefined();
    expect(renameBtn2).toBeDefined();
    expect(renameBtn1.getAttribute("title")).toBe("Rename conversation");
  });

  it("clicking rename enters inline editing and prepopulates the current title", () => {
    render(
      <PastConversationsDialog
        projectId={projectId}
        open={true}
        onOpenChange={mockOnOpenChange}
        onSelect={mockOnSelect}
      />,
    );

    const renameBtn = screen.getByRole("button", {
      name: "Rename First Conversation",
    });
    fireEvent.click(renameBtn);

    // Clicking rename does NOT select the conversation
    expect(mockOnSelect).not.toHaveBeenCalled();

    const input = screen.getByRole("textbox", { name: "Conversation title" });
    expect(input).toBeDefined();
    expect((input as HTMLInputElement).value).toBe("First Conversation");

    const saveBtn = screen.getByRole("button", { name: "Save conversation title" });
    const cancelBtn = screen.getByRole("button", { name: "Cancel renaming" });
    expect(saveBtn).toBeDefined();
    expect(cancelBtn).toBeDefined();
  });

  it("cancelling rename restores original view without invoking mutation or selecting", () => {
    render(
      <PastConversationsDialog
        projectId={projectId}
        open={true}
        onOpenChange={mockOnOpenChange}
        onSelect={mockOnSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename First Conversation" }));

    const cancelBtn = screen.getByRole("button", { name: "Cancel renaming" });
    fireEvent.click(cancelBtn);

    expect(mockRenameConversation).not.toHaveBeenCalled();
    expect(mockOnSelect).not.toHaveBeenCalled();

    // Input disappears, rename button reappears
    expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull();
    expect(screen.getByRole("button", { name: "Rename First Conversation" })).toBeDefined();
  });

  it("submitting trimmed valid title invokes mutation, shows success toast, and exits edit mode", async () => {
    mockRenameConversation.mockResolvedValue("conv_1");

    render(
      <PastConversationsDialog
        projectId={projectId}
        open={true}
        onOpenChange={mockOnOpenChange}
        onSelect={mockOnSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename First Conversation" }));

    const input = screen.getByRole("textbox", { name: "Conversation title" });
    fireEvent.change(input, { target: { value: "   Updated Conversation Name   " } });

    const saveBtn = screen.getByRole("button", { name: "Save conversation title" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockRenameConversation).toHaveBeenCalledTimes(1);
      expect(mockRenameConversation).toHaveBeenCalledWith({
        conversationId: "conv_1",
        title: "Updated Conversation Name",
      });
    });

    expect(toast.success).toHaveBeenCalledWith("Conversation renamed successfully");
    expect(mockOnSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull();
  });

  it("submitting empty or whitespace-only title is blocked with error toast and disables Save button", async () => {
    render(
      <PastConversationsDialog
        projectId={projectId}
        open={true}
        onOpenChange={mockOnOpenChange}
        onSelect={mockOnSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename First Conversation" }));

    const input = screen.getByRole("textbox", { name: "Conversation title" });
    fireEvent.change(input, { target: { value: "    " } });

    const saveBtn = screen.getByRole("button", { name: "Save conversation title" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockRenameConversation).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Conversation title cannot be empty");
  });

  it("shows error toast when rename mutation rejects and preserves editing state", async () => {
    mockRenameConversation.mockRejectedValue(new Error("Server error"));

    render(
      <PastConversationsDialog
        projectId={projectId}
        open={true}
        onOpenChange={mockOnOpenChange}
        onSelect={mockOnSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename First Conversation" }));

    const input = screen.getByRole("textbox", { name: "Conversation title" });
    fireEvent.change(input, { target: { value: "New Name" } });

    const saveBtn = screen.getByRole("button", { name: "Save conversation title" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockRenameConversation).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Server error");
    });

    // Edit input remains visible so user can correct or retry
    expect(screen.getByRole("textbox", { name: "Conversation title" })).toBeDefined();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("normal conversation item click still triggers onSelect and closes dialog", () => {
    render(
      <PastConversationsDialog
        projectId={projectId}
        open={true}
        onOpenChange={mockOnOpenChange}
        onSelect={mockOnSelect}
      />,
    );

    const firstConv = screen.getByText("First Conversation");
    fireEvent.click(firstConv);

    expect(mockOnSelect).toHaveBeenCalledWith("conv_1");
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });
});
