// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock child components that are not under test
vi.mock("@/features/editor/components/top-navigation", () => ({
  TopNavigation: () => <div data-testid="top-navigation" />,
}));

vi.mock("@/features/editor/components/file-breadcrumbs", () => ({
  FileBreadcrumbs: () => <div data-testid="file-breadcrumbs" />,
}));

// Mock CodeEditor so we can trigger onChange and onSave directly from tests
vi.mock("@/features/editor/components/code-editor", () => ({
  CodeEditor: ({
    fileName,
    onChange,
    onSave,
  }: {
    fileName: string;
    initialValue?: string;
    onChange: (value: string) => void;
    onSave?: () => void;
  }) => (
    <div data-testid="mock-code-editor" data-filename={fileName}>
      <input
        data-testid="editor-input"
        onChange={(e) => onChange(e.target.value)}
      />
      <button data-testid="manual-save-btn" onClick={() => onSave?.()}>
        Manual Save
      </button>
    </div>
  ),
}));

// Files repository mock
const mockFilesData: Record<string, { _id: string; name: string; content?: string; updatedAt?: number; storageId?: string }> = {
  file_a: { _id: "file_a", name: "FileA.tsx", content: "initial A", updatedAt: 100 },
  file_b: { _id: "file_b", name: "FileB.tsx", content: "initial B", updatedAt: 100 },
  file_c: { _id: "file_c", name: "FileC.tsx", content: "initial C", updatedAt: 100 },
};

const mockUpdateFile = vi.fn();

vi.mock("@/features/projects/hooks/use-files", () => ({
  useFile: (fileId: string | null) => (fileId ? mockFilesData[fileId] : undefined),
  useUpdateFile: () => mockUpdateFile,
}));

import { EditorView } from "@/features/editor/components/editor-view";
import { useEditorStore } from "@/features/editor/store/use-editor-store";
import { Id } from "@/../convex/_generated/dataModel";

describe("EditorView - Independent Autosave Timers for Dirty Tabs (Issue #43)", () => {
  const projectId = "proj_1" as Id<"projects">;
  const fileA = "file_a" as Id<"files">;
  const fileB = "file_b" as Id<"files">;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockUpdateFile.mockResolvedValue({});

    useEditorStore.setState({ tabs: new Map() });

    // Open fileA and fileB in the store
    const store = useEditorStore.getState();
    store.openFile(projectId, fileA, { pinned: true, initialContent: "initial A", updatedAt: 100 });
    store.openFile(projectId, fileB, { pinned: true, initialContent: "initial B", updatedAt: 100 });
    store.setActiveTab(projectId, fileA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A. Independent timers:
  // 1. Edit tab A and verify timer A is scheduled.
  // 2. Edit tab B before timer A expires.
  // 3. Verify both timers remain independently scheduled.
  // 4. Advance timers and verify both files are saved.
  it("A. maintains independent autosave timers across multiple tabs without cancelling each other", async () => {
    const { rerender } = render(<EditorView projectId={projectId} />);

    // Edit tab A at time 0.0s
    const input = screen.getByTestId("editor-input");
    act(() => {
      fireEvent.change(input, { target: { value: "content A edited" } });
    });

    // Advance 0.5s (before 1.5s debounce expires for A)
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockUpdateFile).not.toHaveBeenCalled();

    // Switch to tab B
    act(() => {
      useEditorStore.getState().setActiveTab(projectId, fileB);
    });
    rerender(<EditorView projectId={projectId} />);

    // Edit tab B at time 0.7s (relative to 0: 500ms + 200ms = 700ms)
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const inputB = screen.getByTestId("editor-input");
    act(() => {
      fireEvent.change(inputB, { target: { value: "content B edited" } });
    });

    // At time 1.5s (another 800ms): timer A fires and saves file A, timer B still pending!
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(1);
    expect(mockUpdateFile).toHaveBeenCalledWith({
      id: fileA,
      content: "content A edited",
    });

    // At time 2.2s (another 700ms): timer B fires and saves file B!
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(2);
    expect(mockUpdateFile).toHaveBeenLastCalledWith({
      id: fileB,
      content: "content B edited",
    });
  });

  // B. Debounce replacement:
  // 5. Edit tab A twice before its debounce expires.
  // 6. Verify the previous timer A is replaced.
  // 7. Verify only the latest A content is saved.
  // 8. Verify tab B's timer remains unaffected.
  it("B. resets only the target file's debounce timer on subsequent edits, keeping other timers intact", async () => {
    const { rerender } = render(<EditorView projectId={projectId} />);

    // Edit tab A at 0ms
    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "A draft 1" } });
    });

    // Switch to B at 500ms and edit B
    act(() => {
      vi.advanceTimersByTime(500);
      useEditorStore.getState().setActiveTab(projectId, fileB);
    });
    rerender(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "B draft 1" } });
    }); // B timer scheduled for 500 + 1500 = 2000ms

    // Switch back to A at 1000ms and edit A again
    act(() => {
      vi.advanceTimersByTime(500);
      useEditorStore.getState().setActiveTab(projectId, fileA);
    });
    rerender(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "A draft 2" } });
    }); // A timer now reset to 1000 + 1500 = 2500ms

    // At 2000ms: B's timer expires and saves B draft 1! A's timer is still pending.
    await act(async () => {
      vi.advanceTimersByTime(1000); // reaches 2000ms
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(1);
    expect(mockUpdateFile).toHaveBeenCalledWith({
      id: fileB,
      content: "B draft 1",
    });

    // At 2500ms: A's reset timer expires and saves latest A draft 2!
    await act(async () => {
      vi.advanceTimersByTime(500); // reaches 2500ms
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(2);
    expect(mockUpdateFile).toHaveBeenLastCalledWith({
      id: fileA,
      content: "A draft 2",
    });
  });

  // C. Tab switching:
  // 9. Edit tab A, switch to tab B, and edit B.
  // 10. Verify switching tabs does not cancel A's pending timer.
  // 11. Verify each save uses the correct file ID and content.
  it("C. switching tabs does not cancel pending timers and saves each file with its originating ID and buffer", async () => {
    const { rerender } = render(<EditorView projectId={projectId} />);

    // Edit tab A
    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "A - specific content" } });
    });

    // Switch to tab B
    act(() => {
      useEditorStore.getState().setActiveTab(projectId, fileB);
    });
    rerender(<EditorView projectId={projectId} />);

    // Even while tab B is active, when timer for A fires, it saves fileA with fileA content
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(1);
    expect(mockUpdateFile).toHaveBeenCalledWith({
      id: fileA,
      content: "A - specific content",
    });
    expect(useEditorStore.getState().isFileDirty(projectId, fileA)).toBe(false);
  });

  // D. In-flight save protection:
  // 12. Start an autosave for A.
  // 13. Edit A again before the first save completes.
  // 14. Resolve the earlier save.
  // 15. Verify the newer content remains dirty and is not incorrectly marked saved.
  it("D. preserves dirty state when a newer edit arrives while an earlier save is in flight", async () => {
    let resolveFirstSave: (val: unknown) => void = () => {};
    mockUpdateFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve;
        })
    );

    render(<EditorView projectId={projectId} />);

    // Edit A to trigger autosave
    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "A version 1" } });
    });

    // Advance 1.5s to trigger autosave for version 1
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(1);
    expect(mockUpdateFile).toHaveBeenCalledWith({
      id: fileA,
      content: "A version 1",
    });

    // Edit A again to produce version 2 while version 1 save is in flight
    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "A version 2" } });
    });

    // Now resolve version 1 save
    await act(async () => {
      resolveFirstSave({});
    });

    // Because buffer is "A version 2" and saved was "A version 1", file must STILL be dirty!
    expect(useEditorStore.getState().isFileDirty(projectId, fileA)).toBe(true);
    expect(useEditorStore.getState().getTabData(projectId, fileA)?.buffer).toBe("A version 2");

    // Advance remaining 1.5s to trigger autosave for version 2
    mockUpdateFile.mockResolvedValueOnce({});
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(2);
    expect(mockUpdateFile).toHaveBeenLastCalledWith({
      id: fileA,
      content: "A version 2",
    });
    expect(useEditorStore.getState().isFileDirty(projectId, fileA)).toBe(false);
  });

  // E. Manual save:
  // 16. Schedule timers for A and B.
  // 17. Manually save A.
  // 18. Verify A's pending timer is cleared.
  // 19. Verify B's pending timer remains active.
  // 20. Verify manual save does not trigger an unnecessary duplicate autosave.
  it("E. manual save clears only the target file's pending timer and leaves other timers active", async () => {
    const { rerender } = render(<EditorView projectId={projectId} />);

    // Edit tab A
    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "A manual test" } });
    });

    // Switch to tab B and edit B
    act(() => {
      vi.advanceTimersByTime(200);
      useEditorStore.getState().setActiveTab(projectId, fileB);
    });
    rerender(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "B manual test" } });
    });

    // Switch back to tab A and trigger manual save
    act(() => {
      useEditorStore.getState().setActiveTab(projectId, fileA);
    });
    rerender(<EditorView projectId={projectId} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("manual-save-btn"));
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(1);
    expect(mockUpdateFile).toHaveBeenCalledWith({
      id: fileA,
      content: "A manual test",
    });

    // Advance 2.0s: A's timer must NOT fire again (no duplicate save), but B's timer MUST fire
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(2);
    expect(mockUpdateFile).toHaveBeenLastCalledWith({
      id: fileB,
      content: "B manual test",
    });
  });

  // F. Error handling:
  // 21. Make A's save fail while B's save succeeds.
  // 22. Verify A's error state is preserved.
  // 23. Verify B's successful save is not affected.
  it("F. handles save error independently without affecting another file's successful save", async () => {
    mockUpdateFile.mockImplementation(async ({ id }: { id: string }) => {
      if (id === fileA) {
        throw new Error("Network disk full");
      }
      return {};
    });

    const { rerender } = render(<EditorView projectId={projectId} />);

    // Edit tab A
    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "A failing content" } });
    });

    // Switch to B and edit B
    act(() => {
      vi.advanceTimersByTime(200);
      useEditorStore.getState().setActiveTab(projectId, fileB);
    });
    rerender(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "B succeeding content" } });
    });

    // Advance timers so both fire
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    const tabDataA = useEditorStore.getState().getTabData(projectId, fileA);
    const tabDataB = useEditorStore.getState().getTabData(projectId, fileB);

    expect(tabDataA?.saveError).toBe("Network disk full");
    expect(tabDataA?.isDirty).toBe(true);

    expect(tabDataB?.saveError).toBeNull();
    expect(tabDataB?.isDirty).toBe(false);
  });

  // G. Cleanup on unmount:
  // 24. Schedule pending timers for multiple files.
  // 25. Unmount EditorView.
  // 26. Advance fake timers.
  // 27. Verify no stale autosave callbacks execute.
  it("G. cleans up all pending autosave timers when EditorView unmounts", async () => {
    const { unmount, rerender } = render(<EditorView projectId={projectId} />);

    // Edit A
    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "A content" } });
    });

    // Switch to B and edit B
    act(() => {
      useEditorStore.getState().setActiveTab(projectId, fileB);
    });
    rerender(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "B content" } });
    });

    // Unmount before either timer expires
    unmount();

    // Advance timers past debounce
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockUpdateFile).not.toHaveBeenCalled();
  });

  // H. Project switching cleanup:
  // 28. If the component receives a new projectId, old timers are cleared.
  it("H. cleans up pending timers when switching projects without unmounting", async () => {
    const { rerender } = render(<EditorView projectId={projectId} />);

    // Edit A
    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "A content" } });
    });

    // Switch project prop
    const nextProjectId = "proj_2" as Id<"projects">;
    rerender(<EditorView projectId={nextProjectId} />);

    // Advance timers
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // Old project's pending timer must not have fired
    expect(mockUpdateFile).not.toHaveBeenCalled();
  });
});

describe("EditorView - Visible Save Control in Status Bar (Issue #77)", () => {
  const projectId = "proj_1" as Id<"projects">;
  const fileA = "file_a" as Id<"files">;
  const fileB = "file_b" as Id<"files">;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockUpdateFile.mockResolvedValue({});

    useEditorStore.setState({ tabs: new Map() });

    const store = useEditorStore.getState();
    store.openFile(projectId, fileA, { pinned: true, initialContent: "initial A", updatedAt: 100 });
    store.openFile(projectId, fileB, { pinned: true, initialContent: "initial B", updatedAt: 100 });
    store.setActiveTab(projectId, fileA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A. Rendering and Accessibility
  it("renders Save button in the status bar with accessible name and title", () => {
    render(<EditorView projectId={projectId} />);

    const saveButton = screen.getByRole("button", { name: "Save file" });
    expect(saveButton).toBeDefined();
    expect(saveButton.getAttribute("title")).toBe("Save file (Ctrl+S / Cmd+S)");
  });

  it("disables Save button when there is no active file", () => {
    useEditorStore.setState({ tabs: new Map() });
    render(<EditorView projectId={projectId} />);

    const saveButton = screen.getByRole("button", { name: "Save file" });
    expect(saveButton.hasAttribute("disabled")).toBe(true);
  });

  it("disables Save button when active file is clean", () => {
    render(<EditorView projectId={projectId} />);

    const saveButton = screen.getByRole("button", { name: "Save file" });
    expect(saveButton.hasAttribute("disabled")).toBe(true);
  });

  it("enables Save button when active file is dirty and not saving", () => {
    render(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "edited A" } });
    });

    const saveButton = screen.getByRole("button", { name: "Save file" });
    expect(saveButton.hasAttribute("disabled")).toBe(false);
  });

  it("disables Save button while a save is in progress", async () => {
    let resolveSave: (value: unknown) => void = () => {};
    mockUpdateFile.mockImplementation(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));

    render(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "saving content" } });
    });

    const saveButton = screen.getByRole("button", { name: "Save file" });
    expect(saveButton.hasAttribute("disabled")).toBe(false);

    // Click Save button
    act(() => {
      fireEvent.click(saveButton);
    });

    // While saving is pending, saveButton should be disabled
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Saving...")).toBeDefined();

    // Resolve save
    await act(async () => {
      resolveSave({});
    });

    // After save completes, file is clean so saveButton is disabled
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Saved")).toBeDefined();
  });

  // B. Manual Save Behavior
  it("clicking Save invokes manual save and updates the current active file", async () => {
    render(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "manual save A" } });
    });

    const saveButton = screen.getByRole("button", { name: "Save file" });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(1);
    expect(mockUpdateFile).toHaveBeenCalledWith({
      id: fileA,
      content: "manual save A",
    });
  });

  it("clicking Save cancels the pending autosave timer for that file", async () => {
    render(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "save once" } });
    });

    const saveButton = screen.getByRole("button", { name: "Save file" });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(1);

    // Advance timers past debounce window
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // Should still only have been called once (autosave timer was cancelled)
    expect(mockUpdateFile).toHaveBeenCalledTimes(1);
  });

  it("clicking Save triggers the same mutation path as Ctrl/Cmd+S", async () => {
    render(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "shortcut equivalence" } });
    });

    const manualSaveBtn = screen.getByTestId("manual-save-btn");
    await act(async () => {
      fireEvent.click(manualSaveBtn);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(1);
    expect(mockUpdateFile).toHaveBeenCalledWith({
      id: fileA,
      content: "shortcut equivalence",
    });
  });

  // C. Failure and Retry
  it("allows retry via Save button after a failed save", async () => {
    mockUpdateFile.mockRejectedValueOnce(new Error("Network error"));

    render(<EditorView projectId={projectId} />);

    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "retry content" } });
    });

    const saveButton = screen.getByRole("button", { name: "Save file" });

    // Initial save attempt fails
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Save failed: Network error")).toBeDefined();

    // Since file is still dirty and no longer saving, Save button is enabled for retry
    expect(saveButton.hasAttribute("disabled")).toBe(false);

    // Second click (retry)
    mockUpdateFile.mockResolvedValueOnce({});
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mockUpdateFile).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saved")).toBeDefined();
    expect(saveButton.hasAttribute("disabled")).toBe(true);
  });

  // D. Conflict and Unsupported Files
  it("preserves conflict detection and does not overwrite remote changes unexpectedly", () => {
    render(<EditorView projectId={projectId} />);

    // Make local edit
    act(() => {
      fireEvent.change(screen.getByTestId("editor-input"), { target: { value: "local edit" } });
    });

    // Simulate external remote update arriving while file is dirty
    act(() => {
      useEditorStore.getState().handleRemoteUpdate(projectId, fileA, "remote concurrent edit", 200);
    });

    // Conflict banner should appear
    expect(screen.getByText("Conflict Detected:")).toBeDefined();
    expect(screen.getByText("Keep my changes & save")).toBeDefined();
    expect(screen.getByText("Accept external changes")).toBeDefined();
  });

  it("handles binary files safely without exposing active editor", () => {
    const fileBinary = "file_bin" as Id<"files">;
    mockFilesData.file_bin = { _id: "file_bin", name: "image.png", storageId: "storage_123" };

    useEditorStore.getState().openFile(projectId, fileBinary, { pinned: true });
    useEditorStore.getState().setActiveTab(projectId, fileBinary);

    render(<EditorView projectId={projectId} />);

    expect(
      screen.getByText(
        "The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding."
      )
    ).toBeDefined();

    const saveButton = screen.getByRole("button", { name: "Save file" });
    expect(saveButton.hasAttribute("disabled")).toBe(true);
  });
});

import { EditorView as CMEditorView } from "@codemirror/view";
import { EditorState as CMEditorState } from "@codemirror/state";
import { suggestion } from "@/features/editor/extensions/suggestion";
import { quickEdit, showQuickEditEffect, quickEditState } from "@/features/editor/extensions/quick-edit";
import * as suggestionFetcherModule from "@/features/editor/extensions/suggestion/fetcher";
import * as quickEditFetcherModule from "@/features/editor/extensions/quick-edit/fetcher";

describe("CodeMirror Extensions - Tab AI State Isolation (Issue #66)", () => {
  let suggestionFetcherSpy: MockInstance<typeof suggestionFetcherModule.fetcher>;
  let quickEditFetcherSpy: MockInstance<typeof quickEditFetcherModule.fetcher>;

  beforeEach(() => {
    vi.useFakeTimers();
    suggestionFetcherSpy = vi.spyOn(suggestionFetcherModule, "fetcher");
    quickEditFetcherSpy = vi.spyOn(quickEditFetcherModule, "fetcher");
  });

  afterEach(() => {
    suggestionFetcherSpy?.mockRestore();
    quickEditFetcherSpy?.mockRestore();
    vi.useRealTimers();
  });

  describe("Suggestion Extension Isolation", () => {
    it("manages independent debounce timers and abort signals across multiple editor views", async () => {
      let signalA: AbortSignal | null = null;
      let signalB: AbortSignal | null = null;

      suggestionFetcherSpy.mockImplementation((payload, signal) => {
        if (payload.fileName === "fileA.ts") {
          signalA = signal;
          return new Promise(() => {});
        }
        if (payload.fileName === "fileB.ts") {
          signalB = signal;
          return new Promise(() => {});
        }
        return Promise.resolve(null);
      });

      const containerA = document.createElement("div");
      const containerB = document.createElement("div");
      document.body.appendChild(containerA);
      document.body.appendChild(containerB);

      const viewA = new CMEditorView({
        state: CMEditorState.create({
          doc: "const a = 1;",
          extensions: [suggestion("fileA.ts")],
        }),
        parent: containerA,
      });

      const viewB = new CMEditorView({
        state: CMEditorState.create({
          doc: "const b = 2;",
          extensions: [suggestion("fileB.ts")],
        }),
        parent: containerB,
      });

      // Typing in View A triggers debounce timer A (300ms)
      viewA.dispatch({
        changes: { from: 12, insert: "\nconst a2 = 2;" },
        selection: { anchor: 26 },
      });

      // Advance 100ms
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(suggestionFetcherSpy).not.toHaveBeenCalled();

      // Typing in View B triggers debounce timer B (300ms)
      viewB.dispatch({
        changes: { from: 12, insert: "\nconst b2 = 3;" },
        selection: { anchor: 26 },
      });

      // Advance 200ms -> at 300ms since viewA typed, timer A fires!
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(suggestionFetcherSpy).toHaveBeenCalledTimes(1);
      expect(signalA).not.toBeNull();
      expect(signalA!.aborted).toBe(false);

      // View A types again before resolveA, triggering abort of previous request A
      viewA.dispatch({
        changes: { from: 26, insert: "\nconst a3 = 3;" },
        selection: { anchor: 40 },
      });
      expect(signalA!.aborted).toBe(true);

      // View B's timer should still fire at 100ms later (total 400ms from start)
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(suggestionFetcherSpy).toHaveBeenCalledTimes(2);
      expect(signalB).not.toBeNull();
      expect(signalB!.aborted).toBe(false);

      // Clean up
      viewA.destroy();
      viewB.destroy();
      containerA.remove();
      containerB.remove();
    });

    it("cancels pending debounce timers and aborts in-flight request when editor view is destroyed", async () => {
      let signalA: AbortSignal | null = null;
      suggestionFetcherSpy.mockImplementation((_payload, signal) => {
        signalA = signal;
        return new Promise(() => {}); // never resolves
      });

      const container = document.createElement("div");
      document.body.appendChild(container);

      const view = new CMEditorView({
        state: CMEditorState.create({
          doc: "const x = 10;",
          extensions: [suggestion("test.ts")],
        }),
        parent: container,
      });

      // Trigger suggestion
      view.dispatch({
        changes: { from: 13, insert: "0" },
        selection: { anchor: 14 },
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(suggestionFetcherSpy).toHaveBeenCalledTimes(1);
      expect(signalA).not.toBeNull();
      expect(signalA!.aborted).toBe(false);

      // Destroy view
      view.destroy();
      expect(signalA!.aborted).toBe(true);

      container.remove();
    });

    it("ignores completed suggestion response if document changed since the request was initiated", async () => {
      let resolveSuggestion: ((val: string | null) => void) | null = null;
      suggestionFetcherSpy.mockImplementation(() => {
        return new Promise((resolve) => {
          resolveSuggestion = resolve;
        });
      });

      const container = document.createElement("div");
      document.body.appendChild(container);

      const view = new CMEditorView({
        state: CMEditorState.create({
          doc: "const initial = 1;",
          extensions: [suggestion("file.ts")],
        }),
        parent: container,
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(suggestionFetcherSpy).toHaveBeenCalledTimes(1);

      // Resolve the suggestion after changing doc without re-triggering (or while doc changed)
      view.dispatch({
        changes: { from: 0, to: 5, insert: "let" },
      });

      await act(async () => {
        resolveSuggestion?.(" // suggested comment");
      });

      // Tab should not insert suggestion because doc mismatch prevented setting suggestion
      // Let's verify doc doesn't have the suggestion
      expect(view.state.doc.toString()).not.toContain("// suggested comment");

      view.destroy();
      container.remove();
    });
  });

  describe("Quick Edit Extension Isolation", () => {
    it("operates strictly on its own EditorView and does not affect other views", async () => {
      let resolveQuickEditA: ((val: string | null) => void) | null = null;

      quickEditFetcherSpy.mockImplementation(() => {
        return new Promise((resolve) => {
          resolveQuickEditA = resolve;
        });
      });

      const containerA = document.createElement("div");
      const containerB = document.createElement("div");
      document.body.appendChild(containerA);
      document.body.appendChild(containerB);

      const viewA = new CMEditorView({
        state: CMEditorState.create({
          doc: "function hello() {\n  return 'hello';\n}",
          selection: { anchor: 9, head: 14 }, // 'hello'
          extensions: [quickEdit("fileA.ts")],
        }),
        parent: containerA,
      });

      const viewB = new CMEditorView({
        state: CMEditorState.create({
          doc: "function world() {\n  return 'world';\n}",
          selection: { anchor: 9, head: 14 }, // 'world'
          extensions: [quickEdit("fileB.ts")],
        }),
        parent: containerB,
      });

      // Open quick-edit tooltip on view A
      viewA.dispatch({
        effects: showQuickEditEffect.of(true),
      });

      expect(viewA.state.field(quickEditState)).toBe(true);
      expect(viewB.state.field(quickEditState)).toBe(false);

      // Find the quick edit input in DOM
      const input = containerA.querySelector("input") as HTMLInputElement;
      expect(input).not.toBeNull();
      input.value = "rename to greet";

      const form = containerA.querySelector("form") as HTMLFormElement;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      expect(quickEditFetcherSpy).toHaveBeenCalledTimes(1);
      expect(quickEditFetcherSpy).toHaveBeenCalledWith(
        {
          selectedCode: "hello",
          fullCode: "function hello() {\n  return 'hello';\n}",
          instruction: "rename to greet",
        },
        expect.any(AbortSignal)
      );

      // Resolve quick edit
      await act(async () => {
        resolveQuickEditA?.("greet");
      });

      // Verify view A was modified
      expect(viewA.state.doc.toString()).toBe("function greet() {\n  return 'hello';\n}");
      // Verify view B was completely untouched
      expect(viewB.state.doc.toString()).toBe("function world() {\n  return 'world';\n}");

      viewA.destroy();
      viewB.destroy();
      containerA.remove();
      containerB.remove();
    });

    it("cancels in-flight quick-edit request on Cancel button without affecting other views", async () => {
      let quickEditSignalA: AbortSignal | null = null;
      quickEditFetcherSpy.mockImplementation((_payload, signal) => {
        quickEditSignalA = signal;
        return new Promise(() => {}); // never resolves
      });

      const containerA = document.createElement("div");
      document.body.appendChild(containerA);

      const viewA = new CMEditorView({
        state: CMEditorState.create({
          doc: "const foo = 1;",
          selection: { anchor: 6, head: 9 }, // 'foo'
          extensions: [quickEdit("fileA.ts")],
        }),
        parent: containerA,
      });

      viewA.dispatch({
        effects: showQuickEditEffect.of(true),
      });

      const input = containerA.querySelector("input") as HTMLInputElement;
      input.value = "change foo";

      const form = containerA.querySelector("form") as HTMLFormElement;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      expect(quickEditSignalA).not.toBeNull();
      expect(quickEditSignalA!.aborted).toBe(false);

      // Click Cancel
      const cancelButton = containerA.querySelectorAll("button")[0];
      cancelButton.click();

      expect(quickEditSignalA!.aborted).toBe(true);
      expect(viewA.state.field(quickEditState)).toBe(false);

      viewA.destroy();
      containerA.remove();
    });
  });
});
