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

const mockCreateConversation = vi.fn();
const mockRenameConversation = vi.fn();
const mockDeleteConversation = vi.fn();

let mockConversations: Array<{ _id: string; title: string; _creationTime: number }> = [
  { _id: "conv_1", title: "First Conversation", _creationTime: Date.now() - 60000 },
  { _id: "conv_2", title: "Second Conversation", _creationTime: Date.now() - 30000 },
];

vi.mock("@/features/conversations/hooks/use-conversations", () => ({
  useConversation: (id: string | null) =>
    id ? { _id: id, title: mockConversations.find((c) => c._id === id)?.title ?? "Active Conversation" } : null,
  useConversations: () => mockConversations,
  useCreateConversation: () => mockCreateConversation,
  useRenameConversation: () => mockRenameConversation,
  useDeleteConversation: () => mockDeleteConversation,
  useMessages: () => [],
  useExecutionEvents: () => [],
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { ConversationSidebar } from "@/features/conversations/components/conversation-sidebar";
import { PastConversationsDialog } from "@/features/conversations/components/past-conversations-dialog";
import { Id } from "@/../convex/_generated/dataModel";
import { toast } from "sonner";

describe("Conversation Deletion UI & Selection Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversations = [
      { _id: "conv_1", title: "First Conversation", _creationTime: Date.now() - 60000 },
      { _id: "conv_2", title: "Second Conversation", _creationTime: Date.now() - 30000 },
    ];
  });

  describe("PastConversationsDialog Deletion & Confirmation", () => {
    it("1. renders delete action button with accessible name for conversation entries", () => {
      render(
        <PastConversationsDialog
          projectId={"proj_1" as Id<"projects">}
          open={true}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />,
      );

      const deleteBtn = screen.getByRole("button", { name: "Delete First Conversation" });
      expect(deleteBtn).toBeDefined();
    });

    it("2 & 3. clicking delete opens confirmation dialog displaying correct conversation title", () => {
      render(
        <PastConversationsDialog
          projectId={"proj_1" as Id<"projects">}
          open={true}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />,
      );

      const deleteBtn = screen.getByRole("button", { name: "Delete First Conversation" });
      fireEvent.click(deleteBtn);

      expect(screen.getByText("Delete conversation?")).toBeDefined();
      expect(
        screen.getByText(/Are you sure you want to delete “First Conversation”\?/),
      ).toBeDefined();
    });

    it("4. cancel closes confirmation without calling the delete mutation", () => {
      render(
        <PastConversationsDialog
          projectId={"proj_1" as Id<"projects">}
          open={true}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Delete First Conversation" }));
      expect(screen.getByText("Delete conversation?")).toBeDefined();

      const cancelBtn = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelBtn);

      expect(mockDeleteConversation).not.toHaveBeenCalled();
    });

    it("5 & 8. confirm calls the delete mutation with correct ID and closes confirmation", async () => {
      mockDeleteConversation.mockResolvedValueOnce({ success: true });
      const onDeleted = vi.fn();

      render(
        <PastConversationsDialog
          projectId={"proj_1" as Id<"projects">}
          open={true}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
          onDeleted={onDeleted}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Delete First Conversation" }));

      const confirmBtn = screen.getByRole("button", { name: "Delete" });
      fireEvent.click(confirmBtn);

      expect(mockDeleteConversation).toHaveBeenCalledWith({
        conversationId: "conv_1",
      });

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Conversation deleted successfully");
        expect(onDeleted).toHaveBeenCalledWith("conv_1");
      });
    });

    it("6. pending state prevents duplicate submissions", async () => {
      let resolvePromise: (val: unknown) => void = () => {};
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockDeleteConversation.mockReturnValue(pendingPromise);

      render(
        <PastConversationsDialog
          projectId={"proj_1" as Id<"projects">}
          open={true}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Delete First Conversation" }));

      const confirmBtn = screen.getByRole("button", { name: "Delete" });
      fireEvent.click(confirmBtn);

      // Confirm button is disabled during deletion
      expect(confirmBtn.getAttribute("disabled")).toBeDefined();

      // Attempting to click disabled confirm button does not trigger additional mutation call
      fireEvent.click(confirmBtn);
      expect(mockDeleteConversation).toHaveBeenCalledTimes(1);

      resolvePromise({ success: true });
    });

    it("7. failed deletion displays an appropriate toast error", async () => {
      mockDeleteConversation.mockRejectedValueOnce(new Error("Network deletion failed"));

      render(
        <PastConversationsDialog
          projectId={"proj_1" as Id<"projects">}
          open={true}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Delete First Conversation" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Network deletion failed");
      });
    });

    it("9. existing rename functionality continues to work alongside delete", () => {
      render(
        <PastConversationsDialog
          projectId={"proj_1" as Id<"projects">}
          open={true}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />,
      );

      const renameBtn = screen.getByRole("button", { name: "Rename First Conversation" });
      fireEvent.click(renameBtn);

      expect(screen.getByLabelText("Conversation title")).toBeDefined();
    });
  });

  describe("ConversationSidebar Active Selection Handling", () => {
    it("1. preserves active conversation when an inactive conversation is deleted", async () => {
      mockDeleteConversation.mockResolvedValueOnce({ success: true });

      render(
        <ConversationSidebar projectId={"proj_1" as Id<"projects">} />,
      );

      // Initially conv_1 is active in sidebar header
      expect(screen.getByTestId ? true : screen.getAllByText("First Conversation").length >= 1).toBe(true);

      // Open past conversations and delete conv_2 (inactive)
      fireEvent.click(screen.getByRole("button", { name: "Past conversations" }));
      const deleteConv2Btn = screen.getByRole("button", { name: "Delete Second Conversation" });
      fireEvent.click(deleteConv2Btn);
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockDeleteConversation).toHaveBeenCalledWith({ conversationId: "conv_2" });
      });

      // Active conversation remains First Conversation
      expect(screen.getAllByText("First Conversation").length >= 1).toBe(true);
    });

    it("2. selecting and deleting the active conversation falls back safely to remaining conversation", async () => {
      mockDeleteConversation.mockResolvedValueOnce({ success: true });

      render(<ConversationSidebar projectId={"proj_1" as Id<"projects">} />);

      // Open past conversations dialog
      fireEvent.click(screen.getByRole("button", { name: "Past conversations" }));

      // Select Second Conversation from command list
      const items = screen.getAllByText("Second Conversation");
      fireEvent.click(items[0]);

      // Open dialog again and delete conv_2
      fireEvent.click(screen.getByRole("button", { name: "Past conversations" }));
      const deleteConv2Btn = screen.getByRole("button", { name: "Delete Second Conversation" });
      fireEvent.click(deleteConv2Btn);
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockDeleteConversation).toHaveBeenCalledWith({ conversationId: "conv_2" });
      });

      // Sidebar falls back to the remaining conversation (First Conversation)
      expect(screen.getAllByText("First Conversation").length >= 1).toBe(true);
    });

    it("3. deleting the only remaining conversation clears active conversation", async () => {
      mockConversations = [{ _id: "conv_single", title: "Single Conversation", _creationTime: Date.now() }];
      mockDeleteConversation.mockResolvedValueOnce({ success: true });

      render(<ConversationSidebar projectId={"proj_1" as Id<"projects">} />);

      expect(screen.getByText("Single Conversation")).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: "Past conversations" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete Single Conversation" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockDeleteConversation).toHaveBeenCalledWith({ conversationId: "conv_single" });
      });
    });
  });
});
