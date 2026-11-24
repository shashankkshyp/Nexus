// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Track mock function calls
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// Mock convex and project hooks to isolate header button rendering and file tree
vi.mock("@/features/projects/hooks/use-projects", () => ({
  useProject: () => ({ _id: "proj_123", name: "Nexus App" }),
}));

let mockFilePathResult: { _id: string; name: string }[] | undefined = undefined;
let mockFolderContentsHandler: ((args: { projectId: Id<"projects">; parentId?: Id<"files">; enabled?: boolean }) => Doc<"files">[] | undefined) | null = null;

vi.mock("@/features/projects/hooks/use-files", () => ({
  useFolderContents: (args: { projectId: Id<"projects">; parentId?: Id<"files">; enabled?: boolean }) => {
    if (mockFolderContentsHandler) {
      return mockFolderContentsHandler(args);
    }
    return [];
  },
  useCreateFile: () => vi.fn(),
  useCreateFolder: () => vi.fn(),
  useRenameFile: () => vi.fn(),
  useDeleteFile: () => vi.fn(),
  useFilePath: () => mockFilePathResult,
}));

vi.mock("@/features/editor/hooks/use-editor", () => ({
  useEditor: () => ({
    openFile: vi.fn(),
    closeTab: vi.fn(),
    activeTabId: null,
  }),
}));

import { FileExplorer } from "@/features/projects/components/file-explorer/index";
import { Tree } from "@/features/projects/components/file-explorer/tree";
import { Doc, Id } from "@/../convex/_generated/dataModel";

describe("FileExplorer header action buttons accessibility", () => {
  it("Test 1 — New File button has accessible name, aria-label, and title", () => {
    render(<FileExplorer projectId={"proj_123" as Id<"projects">} />);

    const newFileButton = screen.getByRole("button", { name: "New file" });
    expect(newFileButton).toBeDefined();
    expect(newFileButton.getAttribute("aria-label")).toBe("New file");
    expect(newFileButton.getAttribute("title")).toBe("New file");
  });

  it("Test 2 — New Folder button has accessible name, aria-label, and title", () => {
    render(<FileExplorer projectId={"proj_123" as Id<"projects">} />);

    const newFolderButton = screen.getByRole("button", { name: "New folder" });
    expect(newFolderButton).toBeDefined();
    expect(newFolderButton.getAttribute("aria-label")).toBe("New folder");
    expect(newFolderButton.getAttribute("title")).toBe("New folder");
  });

  it("Test 3 — Collapse All button has accessible name, aria-label, and title", () => {
    render(<FileExplorer projectId={"proj_123" as Id<"projects">} />);

    const collapseButton = screen.getByRole("button", { name: "Collapse all folders" });
    expect(collapseButton).toBeDefined();
    expect(collapseButton.getAttribute("aria-label")).toBe("Collapse all folders");
    expect(collapseButton.getAttribute("title")).toBe("Collapse all folders");
  });

  it("Test 4 — Expand All button has accessible name, aria-label, and title", () => {
    render(<FileExplorer projectId={"proj_123" as Id<"projects">} />);

    const expandButton = screen.getByRole("button", { name: "Expand all folders" });
    expect(expandButton).toBeDefined();
    expect(expandButton.getAttribute("aria-label")).toBe("Expand all folders");
    expect(expandButton.getAttribute("title")).toBe("Expand all folders");
  });
});

describe("File and folder context menu Copy Path action", () => {
  const mockFileItem: Doc<"files"> = {
    _id: "file_btn" as Id<"files">,
    _creationTime: 1000,
    projectId: "proj_123" as Id<"projects">,
    name: "button.tsx",
    type: "file",
    content: "export const Button = () => null;",
    updatedAt: 1000,
  };

  const mockFolderItem: Doc<"files"> = {
    _id: "folder_components" as Id<"files">,
    _creationTime: 1000,
    projectId: "proj_123" as Id<"projects">,
    name: "components",
    type: "folder",
    updatedAt: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFilePathResult = undefined;
  });

  it("exposes Copy Path, Rename, and Delete actions in file context menu", () => {
    mockFilePathResult = [{ _id: "file_btn", name: "button.tsx" }];

    render(
      <Tree
        item={mockFileItem}
        projectId={"proj_123" as Id<"projects">}
      />
    );

    const trigger = screen.getByRole("button", { name: /button\.tsx/i });
    fireEvent.contextMenu(trigger);

    expect(screen.getByRole("menuitem", { name: /Copy Path/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Rename/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Delete Permanently/i })).toBeDefined();
  });

  it("exposes Copy Path, New File, New Folder, Rename, and Delete in folder context menu", () => {
    mockFilePathResult = [{ _id: "folder_components", name: "components" }];

    render(
      <Tree
        item={mockFolderItem}
        projectId={"proj_123" as Id<"projects">}
      />
    );

    const trigger = screen.getByRole("button", { name: /components/i });
    fireEvent.contextMenu(trigger);

    expect(screen.getByRole("menuitem", { name: /Copy Path/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /New File/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /New Folder/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Rename/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Delete Permanently/i })).toBeDefined();
  });

  it("copies root-level file path to clipboard on success without leading or trailing slash", async () => {
    mockFilePathResult = [{ _id: "file_readme", name: "README.md" }];
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const rootFile: Doc<"files"> = {
      ...mockFileItem,
      _id: "file_readme" as Id<"files">,
      name: "README.md",
    };

    render(<Tree item={rootFile} projectId={"proj_123" as Id<"projects">} />);

    const trigger = screen.getByRole("button", { name: /README\.md/i });
    fireEvent.contextMenu(trigger);

    const copyPathItem = screen.getByRole("menuitem", { name: /Copy Path/i });
    fireEvent.click(copyPathItem);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
      expect(writeTextMock).toHaveBeenCalledWith("README.md");
      expect(mockToastSuccess).toHaveBeenCalledWith("Path copied to clipboard");
      expect(mockToastError).not.toHaveBeenCalled();
    });
  });

  it("copies nested folder path to clipboard using / separator and without trailing slash", async () => {
    mockFilePathResult = [
      { _id: "folder_src", name: "src" },
      { _id: "folder_components", name: "components" },
    ];
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<Tree item={mockFolderItem} projectId={"proj_123" as Id<"projects">} />);

    const trigger = screen.getByRole("button", { name: /components/i });
    fireEvent.contextMenu(trigger);

    const copyPathItem = screen.getByRole("menuitem", { name: /Copy Path/i });
    fireEvent.click(copyPathItem);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
      expect(writeTextMock).toHaveBeenCalledWith("src/components");
      expect(mockToastSuccess).toHaveBeenCalledWith("Path copied to clipboard");
    });
  });

  it("preserves spaces in path segments when copying path", async () => {
    mockFilePathResult = [
      { _id: "folder_src", name: "src" },
      { _id: "folder_my_comp", name: "My Components" },
      { _id: "file_btn", name: "button.tsx" },
    ];
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<Tree item={mockFileItem} projectId={"proj_123" as Id<"projects">} />);

    const trigger = screen.getByRole("button", { name: /button\.tsx/i });
    fireEvent.contextMenu(trigger);

    const copyPathItem = screen.getByRole("menuitem", { name: /Copy Path/i });
    fireEvent.click(copyPathItem);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("src/My Components/button.tsx");
      expect(mockToastSuccess).toHaveBeenCalledWith("Path copied to clipboard");
    });
  });

  it("preserves Unicode characters in path segments", async () => {
    mockFilePathResult = [
      { _id: "folder_assets", name: "assets" },
      { _id: "file_icon", name: "图标.svg" },
    ];
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const unicodeFile: Doc<"files"> = {
      ...mockFileItem,
      _id: "file_icon" as Id<"files">,
      name: "图标.svg",
    };

    render(<Tree item={unicodeFile} projectId={"proj_123" as Id<"projects">} />);

    const trigger = screen.getByRole("button", { name: /图标\.svg/i });
    fireEvent.contextMenu(trigger);

    const copyPathItem = screen.getByRole("menuitem", { name: /Copy Path/i });
    fireEvent.click(copyPathItem);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("assets/图标.svg");
      expect(mockToastSuccess).toHaveBeenCalledWith("Path copied to clipboard");
    });
  });

  it("handles clipboard writeText rejection with error toast without crashing", async () => {
    mockFilePathResult = [{ _id: "file_btn", name: "button.tsx" }];
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Permission denied"));
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<Tree item={mockFileItem} projectId={"proj_123" as Id<"projects">} />);

    const trigger = screen.getByRole("button", { name: /button\.tsx/i });
    fireEvent.contextMenu(trigger);

    const copyPathItem = screen.getByRole("menuitem", { name: /Copy Path/i });
    fireEvent.click(copyPathItem);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
      expect(mockToastError).toHaveBeenCalledWith("Failed to copy path to clipboard");
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });
  });

  it("handles clipboard API being unavailable gracefully", async () => {
    mockFilePathResult = [{ _id: "file_btn", name: "button.tsx" }];
    Object.assign(navigator, {
      clipboard: undefined,
    });

    render(<Tree item={mockFileItem} projectId={"proj_123" as Id<"projects">} />);

    const trigger = screen.getByRole("button", { name: /button\.tsx/i });
    fireEvent.contextMenu(trigger);

    const copyPathItem = screen.getByRole("menuitem", { name: /Copy Path/i });
    fireEvent.click(copyPathItem);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Failed to copy path to clipboard");
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });
  });

  it("handles loading path state safely without copying", async () => {
    mockFilePathResult = undefined; // loading state
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<Tree item={mockFileItem} projectId={"proj_123" as Id<"projects">} />);

    const trigger = screen.getByRole("button", { name: /button\.tsx/i });
    fireEvent.contextMenu(trigger);

    const copyPathItem = screen.getByRole("menuitem", { name: /Copy Path/i });
    fireEvent.click(copyPathItem);

    await waitFor(() => {
      expect(writeTextMock).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith("Path is still loading");
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });
  });

  it("handles missing or empty path result safely", async () => {
    mockFilePathResult = []; // empty or deleted item path
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<Tree item={mockFileItem} projectId={"proj_123" as Id<"projects">} />);

    const trigger = screen.getByRole("button", { name: /button\.tsx/i });
    fireEvent.contextMenu(trigger);

    const copyPathItem = screen.getByRole("menuitem", { name: /Copy Path/i });
    fireEvent.click(copyPathItem);

    await waitFor(() => {
      expect(writeTextMock).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith("Unable to resolve path");
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });
  });
});

describe("FileExplorer Expand All and Collapse All recursive functionality (Issue #99)", () => {
  const projectId = "proj_123" as Id<"projects">;

  // Folder and file fixtures matching nested hierarchy:
  // project/
  //   src/
  //     components/
  //       ui/
  //         button.tsx
  //     hooks/
  //       use-example.ts
  //   tests/
  //     unit/
  //       example.test.ts
  const folderSrc: Doc<"files"> = {
    _id: "folder_src" as Id<"files">,
    _creationTime: 1,
    projectId,
    name: "src",
    type: "folder",
    updatedAt: 1,
  };

  const folderTests: Doc<"files"> = {
    _id: "folder_tests" as Id<"files">,
    _creationTime: 2,
    projectId,
    name: "tests",
    type: "folder",
    updatedAt: 2,
  };

  const folderComponents: Doc<"files"> = {
    _id: "folder_components" as Id<"files">,
    _creationTime: 3,
    projectId,
    name: "components",
    type: "folder",
    parentId: "folder_src" as Id<"files">,
    updatedAt: 3,
  };

  const folderHooks: Doc<"files"> = {
    _id: "folder_hooks" as Id<"files">,
    _creationTime: 4,
    projectId,
    name: "hooks",
    type: "folder",
    parentId: "folder_src" as Id<"files">,
    updatedAt: 4,
  };

  const folderUi: Doc<"files"> = {
    _id: "folder_ui" as Id<"files">,
    _creationTime: 5,
    projectId,
    name: "ui",
    type: "folder",
    parentId: "folder_components" as Id<"files">,
    updatedAt: 5,
  };

  const fileButton: Doc<"files"> = {
    _id: "file_button" as Id<"files">,
    _creationTime: 6,
    projectId,
    name: "button.tsx",
    type: "file",
    parentId: "folder_ui" as Id<"files">,
    updatedAt: 6,
  };

  const fileHook: Doc<"files"> = {
    _id: "file_hook" as Id<"files">,
    _creationTime: 7,
    projectId,
    name: "use-example.ts",
    type: "file",
    parentId: "folder_hooks" as Id<"files">,
    updatedAt: 7,
  };

  const folderUnit: Doc<"files"> = {
    _id: "folder_unit" as Id<"files">,
    _creationTime: 8,
    projectId,
    name: "unit",
    type: "folder",
    parentId: "folder_tests" as Id<"files">,
    updatedAt: 8,
  };

  const fileTest: Doc<"files"> = {
    _id: "file_test" as Id<"files">,
    _creationTime: 9,
    projectId,
    name: "example.test.ts",
    type: "file",
    parentId: "folder_unit" as Id<"files">,
    updatedAt: 9,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFolderContentsHandler = null;
  });

  it("B. expands all nested folders recursively when Expand all is clicked", async () => {
    mockFolderContentsHandler = ({ parentId, enabled }) => {
      if (!enabled) return undefined;
      if (!parentId) return [folderSrc, folderTests];
      if (parentId === "folder_src") return [folderComponents, folderHooks];
      if (parentId === "folder_components") return [folderUi];
      if (parentId === "folder_ui") return [fileButton];
      if (parentId === "folder_hooks") return [fileHook];
      if (parentId === "folder_tests") return [folderUnit];
      if (parentId === "folder_unit") return [fileTest];
      return [];
    };

    render(<FileExplorer projectId={projectId} />);

    // Initially root folders are rendered but closed
    expect(screen.getByText("src")).toBeDefined();
    expect(screen.getByText("tests")).toBeDefined();
    expect(screen.queryByText("components")).toBeNull();
    expect(screen.queryByText("button.tsx")).toBeNull();

    // Click Expand all folders
    const expandBtn = screen.getByRole("button", { name: "Expand all folders" });
    fireEvent.click(expandBtn);

    // Deepest nested elements must be revealed across all branches
    await waitFor(() => {
      expect(screen.getByText("button.tsx")).toBeDefined();
      expect(screen.getByText("use-example.ts")).toBeDefined();
      expect(screen.getByText("example.test.ts")).toBeDefined();
    });
  });

  it("C. propagates expansion to asynchronous descendants as their folder queries resolve", async () => {
    let resolveComponents = false;
    let resolveUi = false;

    mockFolderContentsHandler = ({ parentId, enabled }) => {
      if (!enabled) return undefined;
      if (!parentId) return [folderSrc];
      if (parentId === "folder_src") {
        return [folderComponents];
      }
      if (parentId === "folder_components") {
        return resolveComponents ? [folderUi] : undefined; // simulates delayed loading
      }
      if (parentId === "folder_ui") {
        return resolveUi ? [fileButton] : undefined; // simulates deeper delayed loading
      }
      return [];
    };

    const { rerender } = render(<FileExplorer projectId={projectId} />);

    const expandBtn = screen.getByRole("button", { name: "Expand all folders" });
    fireEvent.click(expandBtn);

    // Level 1: src opened, components is rendered and query for components is loading
    await waitFor(() => {
      expect(screen.getByText("components")).toBeDefined();
    });
    expect(screen.queryByText("ui")).toBeNull();

    // Now components contents resolve asynchronously
    resolveComponents = true;
    rerender(<FileExplorer projectId={projectId} />);

    // Newly mounted child folder `ui` receives expandKey and opens automatically
    await waitFor(() => {
      expect(screen.getByText("ui")).toBeDefined();
    });
    expect(screen.queryByText("button.tsx")).toBeNull();

    // Now ui contents resolve asynchronously
    resolveUi = true;
    rerender(<FileExplorer projectId={projectId} />);

    // Deepest child button.tsx is rendered
    await waitFor(() => {
      expect(screen.getByText("button.tsx")).toBeDefined();
    });
  });

  it("D. closes every expanded folder on Collapse all and ensures closed state when reopening parent", async () => {
    mockFolderContentsHandler = ({ parentId, enabled }) => {
      if (!enabled) return undefined;
      if (!parentId) return [folderSrc];
      if (parentId === "folder_src") return [folderComponents];
      if (parentId === "folder_components") return [folderUi];
      if (parentId === "folder_ui") return [fileButton];
      return [];
    };

    render(<FileExplorer projectId={projectId} />);

    // Expand all
    fireEvent.click(screen.getByRole("button", { name: "Expand all folders" }));
    await waitFor(() => {
      expect(screen.getByText("button.tsx")).toBeDefined();
    });

    // Collapse all
    fireEvent.click(screen.getByRole("button", { name: "Collapse all folders" }));

    // Everything below root files should be unmounted / closed
    expect(screen.queryByText("components")).toBeNull();
    expect(screen.queryByText("button.tsx")).toBeNull();

    // Manually open folderSrc
    fireEvent.click(screen.getByRole("button", { name: /src/i }));

    // components is rendered again, but should be CLOSED by default (not auto-expanded by previous expandKey)
    await waitFor(() => {
      expect(screen.getByText("components")).toBeDefined();
    });
    expect(screen.queryByText("ui")).toBeNull();
  });

  it("E. allows manual folder toggles after Expand all and after Collapse all without affecting global state", async () => {
    mockFolderContentsHandler = ({ parentId, enabled }) => {
      if (!enabled) return undefined;
      if (!parentId) return [folderSrc, folderTests];
      if (parentId === "folder_src") return [folderComponents];
      if (parentId === "folder_components") return [folderUi];
      if (parentId === "folder_ui") return [fileButton];
      if (parentId === "folder_tests") return [folderUnit];
      if (parentId === "folder_unit") return [fileTest];
      return [];
    };

    render(<FileExplorer projectId={projectId} />);

    // Expand all
    fireEvent.click(screen.getByRole("button", { name: "Expand all folders" }));
    await waitFor(() => {
      expect(screen.getByText("button.tsx")).toBeDefined();
      expect(screen.getByText("example.test.ts")).toBeDefined();
    });

    // Manually close tests folder
    const testsBtn = screen.getByRole("button", { name: /tests/i });
    fireEvent.click(testsBtn);

    // tests children unmount, but src children remain open
    expect(screen.queryByText("example.test.ts")).toBeNull();
    expect(screen.getByText("button.tsx")).toBeDefined();

    // Manually reopen tests folder
    fireEvent.click(testsBtn);
    await waitFor(() => {
      expect(screen.getByText("unit")).toBeDefined();
    });

    // Collapse all
    fireEvent.click(screen.getByRole("button", { name: "Collapse all folders" }));
    expect(screen.queryByText("components")).toBeNull();
    expect(screen.queryByText("unit")).toBeNull();

    // Manually open src folder
    fireEvent.click(screen.getByRole("button", { name: /src/i }));
    await waitFor(() => {
      expect(screen.getByText("components")).toBeDefined();
    });
  });

  it("F. handles edge cases: empty folders, repeated Expand/Collapse, and rapid switches", async () => {
    const emptyFolder: Doc<"files"> = {
      _id: "folder_empty" as Id<"files">,
      _creationTime: 10,
      projectId,
      name: "empty_dir",
      type: "folder",
      updatedAt: 10,
    };

    mockFolderContentsHandler = ({ parentId, enabled }) => {
      if (!enabled) return undefined;
      if (!parentId) return [emptyFolder];
      if (parentId === "folder_empty") return []; // empty folder
      return [];
    };

    render(<FileExplorer projectId={projectId} />);

    const expandBtn = screen.getByRole("button", { name: "Expand all folders" });
    const collapseBtn = screen.getByRole("button", { name: "Collapse all folders" });

    // Repeated Expand all calls
    fireEvent.click(expandBtn);
    fireEvent.click(expandBtn);
    expect(screen.getByText("empty_dir")).toBeDefined();

    // Immediate collapse followed by immediate expand
    fireEvent.click(collapseBtn);
    fireEvent.click(expandBtn);
    expect(screen.getByText("empty_dir")).toBeDefined();

    // Collapse again
    fireEvent.click(collapseBtn);
    expect(screen.getByText("empty_dir")).toBeDefined();
  });
});
