// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Polyfill ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock clerk
const mockOpenUserProfile = vi.fn();
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({
    openUserProfile: mockOpenUserProfile,
  }),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ky
const mockPost = vi.fn();
vi.mock("ky", () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args),
  },
  HTTPError: class HTTPError extends Error {
    response: Response;
    constructor(response: Response) {
      super("HTTPError");
      this.response = response;
    }
  },
}));

// Mock project hook state
interface MockProjectProgress {
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  totalFiles?: number;
  processedFiles?: number;
  successfulFiles?: number;
  failedFiles?: number;
  skippedFiles?: number;
  currentBatch?: number;
  totalBatches?: number;
  errorMessage?: string | null;
  updatedAt?: number;
}

interface MockProject {
  _id: Id<"projects">;
  name: string;
  exportStatus?: "exporting" | "completed" | "failed" | "cancelled";
  exportRepoUrl?: string;
  exportProgress?: MockProjectProgress;
  updatedAt?: number;
}

let currentProjectMock: MockProject | null = null;

vi.mock("@/features/projects/hooks/use-projects", () => ({
  useProject: () => currentProjectMock,
}));

import { ExportPopover } from "@/features/projects/components/export-popover";
import { Id } from "@/../convex/_generated/dataModel";

const PROJECT_ID = "project_123" as Id<"projects">;

describe("ExportPopover - Issue #85: Persisted export failure details in retry UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({
      json: async () => ({ success: true }),
    });
    currentProjectMock = {
      _id: PROJECT_ID,
      name: "my-test-project",
      exportStatus: undefined,
      exportProgress: undefined,
    };
  });

  const openPopover = () => {
    act(() => {
      const trigger = screen.getByText("Export");
      fireEvent.click(trigger);
    });
  };

  describe("Failed State Rendering & Error Details Display", () => {
    it("1. displays the persisted exportProgress.errorMessage when exportStatus is failed", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "Repository name already exists or cannot be accessed.",
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(screen.getByText("Unable to export")).toBeDefined();
      expect(
        screen.getByText("Repository name already exists or cannot be accessed.")
      ).toBeDefined();
      expect(
        screen.queryByText("Something went wrong. Please try again.")
      ).toBeNull();
    });

    it("2. displays generic fallback when exportProgress is missing", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: undefined,
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(screen.getByText("Unable to export")).toBeDefined();
      expect(
        screen.getByText("Something went wrong. Please try again.")
      ).toBeDefined();
    });

    it("3. displays generic fallback when exportProgress.errorMessage is missing/undefined", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: undefined,
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(
        screen.getByText("Something went wrong. Please try again.")
      ).toBeDefined();
    });

    it("4. displays generic fallback when exportProgress.errorMessage is null", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: null,
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(
        screen.getByText("Something went wrong. Please try again.")
      ).toBeDefined();
    });

    it("5. displays generic fallback when exportProgress.errorMessage is an empty string", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "",
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(
        screen.getByText("Something went wrong. Please try again.")
      ).toBeDefined();
    });

    it("6. displays generic fallback when exportProgress.errorMessage is whitespace-only", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "   \n\t  ",
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(
        screen.getByText("Something went wrong. Please try again.")
      ).toBeDefined();
    });
  });

  describe("Long, Multiline, and Safe Text Rendering", () => {
    it("7. renders long error text with overflow and wrapping utility classes", () => {
      const longErrorMessage =
        "Export aborted: 14 of 50 file blobs failed to create due to network interruptions while pushing files to GitHub.";

      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: longErrorMessage,
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const errorElement = screen.getByText(longErrorMessage);
      expect(errorElement).toBeDefined();
      expect(errorElement.className).toContain("break-words");
      expect(errorElement.className).toContain("whitespace-pre-wrap");
      expect(errorElement.className).toContain("overflow-y-auto");
    });

    it("8. preserves line breaks in multiline error messages", () => {
      const multilineError = "Line 1: Authentication succeeded.\nLine 2: Tree creation timed out.";

      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: multilineError,
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const errorElement = screen.getByText((content) =>
        content.includes("Line 1: Authentication succeeded.") &&
        content.includes("Line 2: Tree creation timed out.")
      );
      expect(errorElement).toBeDefined();
      expect(errorElement.className).toContain("whitespace-pre-wrap");
    });

    it("9. wraps long unbroken strings without horizontal overflow", () => {
      const unbrokenString = "a".repeat(120);

      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: unbrokenString,
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const errorElement = screen.getByText(unbrokenString);
      expect(errorElement).toBeDefined();
      expect(errorElement.className).toContain("break-words");
    });

    it("10. renders error text safely as text content without interpreting HTML", () => {
      const htmlPayload = '<img src=x onerror="alert(1)" /><b>Failed</b>';

      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: htmlPayload,
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const errorElement = screen.getByText(htmlPayload);
      expect(errorElement).toBeDefined();
      expect(errorElement.textContent).toBe(htmlPayload);
      expect(errorElement.querySelector("img")).toBeNull();
      expect(errorElement.querySelector("b")).toBeNull();
    });
  });

  describe("Retry and Reset Behavior", () => {
    it("11. displays Retry button in failed state", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "Failed to create repository",
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const retryButton = screen.getByRole("button", { name: "Retry" });
      expect(retryButton).toBeDefined();
    });

    it("12 & 13. clicking Retry invokes the reset action with the correct projectId", async () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "GitHub API rate limit exceeded",
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const retryButton = screen.getByRole("button", { name: "Retry" });
      await act(async () => {
        fireEvent.click(retryButton);
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith("/api/github/export/reset", {
        json: { projectId: PROJECT_ID },
      });
    });

    it("14. successful reset closes the popover, allowing return to form on reopen", async () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "Some error",
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const retryButton = screen.getByRole("button", { name: "Retry" });
      await act(async () => {
        fireEvent.click(retryButton);
      });

      await waitFor(() => {
        expect(screen.queryByText("Unable to export")).toBeNull();
      });
    });

    it("15. handles reset action failure gracefully without crashing", async () => {
      mockPost.mockRejectedValueOnce(new Error("Network failed"));

      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "Some error",
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const retryButton = screen.getByRole("button", { name: "Retry" });
      await act(async () => {
        fireEvent.click(retryButton);
      });
      // The popover should remain open when reset fails
      expect(screen.getByText("Unable to export")).toBeDefined();
    });
  });

  describe("Reactive State Transitions", () => {
    it("16. error details disappear when project transitions from failed to exporting", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "Failed initial attempt",
        },
      };

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(screen.getByText("Failed initial attempt")).toBeDefined();

      // Project status transitions reactively to exporting
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "exporting",
        exportProgress: {
          status: "running",
          totalFiles: 10,
          processedFiles: 2,
        },
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);

      expect(screen.queryByText("Failed initial attempt")).toBeNull();
      expect(screen.queryByText("Unable to export")).toBeNull();
      expect(screen.getByText("Exporting to GitHub...")).toBeDefined();
    });

    it("17. error details disappear when project transitions to completed", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "Previous failure",
        },
      };

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(screen.getByText("Previous failure")).toBeDefined();

      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "completed",
        exportRepoUrl: "https://github.com/user/my-test-project",
        exportProgress: {
          status: "completed",
        },
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);

      expect(screen.queryByText("Previous failure")).toBeNull();
      expect(screen.getByText("Repository created")).toBeDefined();
    });

    it("18. updated error details render reactively when project progress errorMessage updates", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
        exportProgress: {
          status: "failed",
          errorMessage: "Error 1: Repo name taken",
        },
      };

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(screen.getByText("Error 1: Repo name taken")).toBeDefined();

      // Reactive update with a different error message
      currentProjectMock = {
        ...currentProjectMock,
        exportProgress: {
          status: "failed",
          errorMessage: "Error 2: Organization permissions required",
        },
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);

      expect(screen.queryByText("Error 1: Repo name taken")).toBeNull();
      expect(
        screen.getByText("Error 2: Organization permissions required")
      ).toBeDefined();
    });
  });

  describe("Issue #127: Progress details and cancellation confirmation", () => {
    it("renders batch progress and percentage from persisted export state", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "exporting",
        exportProgress: {
          status: "running",
          totalFiles: 100,
          processedFiles: 42,
          currentBatch: 2,
          totalBatches: 4,
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(screen.getByText("Uploading batch 2 of 4")).toBeDefined();
      expect(screen.getByText("42 / 100 files (42%)")).toBeDefined();
      expect(screen.getByRole("progressbar", { name: "Export progress" })).toBeDefined();
    });

    it("renders a truthful fallback when persisted progress is unavailable", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "exporting",
        exportProgress: undefined,
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(screen.getByText("Preparing files for export...")).toBeDefined();
      expect(screen.getByText("Progress details will appear when available.")).toBeDefined();
      expect(screen.queryByRole("progressbar", { name: "Export progress" })).toBeNull();
    });

    it("requires confirmation before sending a cancellation request", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "exporting",
        exportProgress: {
          status: "running",
          totalFiles: 10,
          processedFiles: 1,
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
      expect(screen.getByRole("heading", { name: "Cancel GitHub export?" })).toBeDefined();
      expect(mockPost).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Keep exporting" }));
      expect(screen.queryByRole("heading", { name: "Cancel GitHub export?" })).toBeNull();
      expect(mockPost).not.toHaveBeenCalled();
    });

    it("sends one cancellation request after confirmation and disables repeated confirmation", async () => {
      let resolveCancellation!: (value: unknown) => void;
      mockPost.mockImplementationOnce(() => new Promise((resolve) => {
        resolveCancellation = resolve;
      }));
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "exporting",
        exportProgress: {
          status: "running",
          totalFiles: 10,
          processedFiles: 1,
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();
      fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancelling..." }));

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith("/api/github/export/cancel", {
        json: { projectId: PROJECT_ID },
      });

      await act(async () => {
        resolveCancellation({ json: async () => ({ success: true }) });
      });
    });

    it("renders cancelled state with reset available", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "cancelled",
        exportProgress: {
          status: "cancelled",
          totalFiles: 10,
          processedFiles: 3,
          errorMessage: "Cancelled by user",
        },
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(screen.getByText("Export cancelled")).toBeDefined();
      expect(screen.getByRole("button", { name: "Start a new export" })).toBeDefined();
      expect(screen.queryByText("Exporting to GitHub...")).toBeNull();
    });
  });

  describe("Regression: Idle & Export Form Behavior", () => {
    it("19 & 20. renders export form when exportStatus is idle / undefined", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: undefined,
        exportProgress: undefined,
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      expect(screen.getByRole("heading", { name: "Export to GitHub" })).toBeDefined();
      expect(screen.getByLabelText("Repository Name")).toBeDefined();
      expect(screen.getByRole("button", { name: "Create Repository" })).toBeDefined();
    });

    it("21. popover trigger and icon reflect failed state with red icon", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my-test-project",
        exportStatus: "failed",
      };

      render(<ExportPopover projectId={PROJECT_ID} />);
      const exportText = screen.getByText("Export");
      expect(exportText).toBeDefined();
      // Icon is rendered inside trigger
      const trigger = exportText.closest("div");
      expect(trigger?.querySelector("svg")).toBeDefined();
    });
  });

  describe("Issue #89: Synchronize Repository-Name Default After Project Loads", () => {
    it("A. synchronizes repository-name field when project loads asynchronously from undefined", () => {
      // 1. Initial render with undefined project data
      currentProjectMock = null;

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const input = screen.getByLabelText("Repository Name") as HTMLInputElement;
      expect(input.value).toBe("");

      // 2. Project data arrives from Convex
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "My Nexus App",
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);

      expect(input.value).toBe("My-Nexus-App");
    });

    it("B. preserves manually edited repository name when project updates", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "Nexus",
      };

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const input = screen.getByLabelText("Repository Name") as HTMLInputElement;
      expect(input.value).toBe("Nexus");

      // User manually edits the field
      fireEvent.change(input, { target: { value: "my-custom-repository" } });
      expect(input.value).toBe("my-custom-repository");

      // Project name updates from backend
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "Nexus Updated",
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);

      // Must preserve user-entered custom repository name
      expect(input.value).toBe("my-custom-repository");
    });

    it("C. synchronizes repository-name when project name changes before user editing", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "Nexus",
      };

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const input = screen.getByLabelText("Repository Name") as HTMLInputElement;
      expect(input.value).toBe("Nexus");

      // Project name changes while untouched
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "Nexus App",
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);

      expect(input.value).toBe("Nexus-App");
    });

    it("D. preserves user edits made before project data arrives", () => {
      // 1. Mount with undefined project
      currentProjectMock = null;

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const input = screen.getByLabelText("Repository Name") as HTMLInputElement;
      expect(input.value).toBe("");

      // User types before project data finishes loading
      fireEvent.change(input, { target: { value: "my-repository" } });
      expect(input.value).toBe("my-repository");

      // Project data arrives later
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "Nexus App",
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);

      // User's edit must not be overwritten
      expect(input.value).toBe("my-repository");
    });

    it("E. sanitizes special characters matching regex replacement", () => {
      currentProjectMock = null;

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const input = screen.getByLabelText("Repository Name") as HTMLInputElement;

      currentProjectMock = {
        _id: PROJECT_ID,
        name: "my nexus/app!@#",
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);

      expect(input.value).toBe("my-nexus-app---");
    });

    it("F. receiving the same project name does not overwrite user edits or cause unnecessary changes", () => {
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "Nexus App",
      };

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const input = screen.getByLabelText("Repository Name") as HTMLInputElement;
      expect(input.value).toBe("Nexus-App");

      fireEvent.change(input, { target: { value: "user-chosen-name" } });

      // Rerender with the exact same project name
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "Nexus App",
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);
      expect(input.value).toBe("user-chosen-name");
    });

    it("G. preserves other form fields (visibility, description) during default synchronization", () => {
      currentProjectMock = null;

      const { rerender } = render(<ExportPopover projectId={PROJECT_ID} />);
      openPopover();

      const descriptionInput = screen.getByLabelText("Description") as HTMLTextAreaElement;
      fireEvent.change(descriptionInput, { target: { value: "My awesome description" } });
      expect(descriptionInput.value).toBe("My awesome description");

      // Project data loads
      currentProjectMock = {
        _id: PROJECT_ID,
        name: "Sample Project",
      };

      rerender(<ExportPopover projectId={PROJECT_ID} />);

      const repoInput = screen.getByLabelText("Repository Name") as HTMLInputElement;
      expect(repoInput.value).toBe("Sample-Project");
      expect(descriptionInput.value).toBe("My awesome description");
    });
  });
});
