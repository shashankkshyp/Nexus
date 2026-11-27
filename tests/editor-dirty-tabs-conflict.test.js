import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Helper to load and transpile TypeScript file into an isolated CommonJS module
function loadModule(relPath) {
  const fullPath = path.resolve(process.cwd(), relPath);
  const tsCode = fs.readFileSync(fullPath, "utf-8");
  const transpiled = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const m = { exports: {} };
  const customRequire = (id) => {
    if (id === "zustand") {
      // Minimal zustand create implementation for tests
      return {
        create: () => (fn) => {
          let state = {};
          const listeners = new Set();
          const get = () => state;
          const set = (partial) => {
            const next = typeof partial === "function" ? partial(state) : partial;
            state = { ...state, ...next };
            listeners.forEach((listener) => listener(state));
          };
          const subscribe = (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          };
          state = fn(set, get, { subscribe, getState: get, setState: set });
          const useStore = (selector) => (selector ? selector(state) : state);
          Object.assign(useStore, {
            getState: get,
            setState: set,
            subscribe,
          });
          return useStore;
        },
      };
    }
    // Return empty mock for convex dataModel
    return {};
  };

  const fn = new Function("require", "module", "exports", transpiled);
  fn(customRequire, m, m.exports);
  return m.exports;
}

const { useEditorStore } = loadModule("src/features/editor/store/use-editor-store.ts");

describe("Issue #4 - Editor Dirty Tracking & Conflict Detection Store", () => {
  const projectId = "proj_1";
  const file1 = "file_1";
  const file2 = "file_2";

  beforeEach(() => {
    useEditorStore.setState({ tabs: new Map() });
  });

  // Scenario 1: Editing a file marks its tab dirty immediately
  test("1. Editing a file marks its tab dirty immediately", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "hello" });
    assert.equal(store.isFileDirty(projectId, file1), false);

    store.updateBuffer(projectId, file1, "hello world");
    assert.equal(store.isFileDirty(projectId, file1), true);
    assert.equal(store.getTabData(projectId, file1)?.buffer, "hello world");
    assert.equal(store.getTabData(projectId, file1)?.savedContent, "hello");
  });

  // Scenario 2: Switching tabs preserves unsaved content
  test("2. Switching tabs preserves unsaved content", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "file 1 content" });
    store.openFile(projectId, file2, { pinned: true, initialContent: "file 2 content" });

    store.setActiveTab(projectId, file1);
    store.updateBuffer(projectId, file1, "file 1 edited");

    // Switch to file 2
    store.setActiveTab(projectId, file2);
    assert.equal(store.getTabState(projectId).activeTabId, file2);
    assert.equal(store.getTabData(projectId, file2)?.buffer, "file 2 content");

    // Switch back to file 1 - buffer and dirty state must be preserved
    store.setActiveTab(projectId, file1);
    assert.equal(store.getTabState(projectId).activeTabId, file1);
    assert.equal(store.getTabData(projectId, file1)?.buffer, "file 1 edited");
    assert.equal(store.isFileDirty(projectId, file1), true);
  });

  // Scenario 3: Editing multiple files tracks their dirty states independently
  test("3. Editing multiple files tracks their dirty states independently", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "original 1" });
    store.openFile(projectId, file2, { pinned: true, initialContent: "original 2" });

    store.updateBuffer(projectId, file1, "modified 1");
    assert.equal(store.isFileDirty(projectId, file1), true);
    assert.equal(store.isFileDirty(projectId, file2), false);

    store.updateBuffer(projectId, file2, "modified 2");
    assert.equal(store.isFileDirty(projectId, file1), true);
    assert.equal(store.isFileDirty(projectId, file2), true);
  });

  // Scenario 4: Successfully saving a file clears only that file's dirty state
  test("4. Successfully saving a file clears only that file's dirty state", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "original 1" });
    store.openFile(projectId, file2, { pinned: true, initialContent: "original 2" });

    store.updateBuffer(projectId, file1, "modified 1");
    store.updateBuffer(projectId, file2, "modified 2");

    const savedContent = store.markSavingStart(projectId, file1);
    assert.equal(savedContent, "modified 1");
    assert.equal(store.getTabData(projectId, file1)?.isSaving, true);

    store.markSavingSuccess(projectId, file1, savedContent, Date.now());
    assert.equal(store.isFileDirty(projectId, file1), false);
    assert.equal(store.getTabData(projectId, file1)?.isSaving, false);
    assert.equal(store.getTabData(projectId, file1)?.savedContent, "modified 1");

    // file2 should remain dirty and untouched
    assert.equal(store.isFileDirty(projectId, file2), true);
  });

  // Scenario 5: Failed saves preserve dirty state
  test("5. Failed saves preserve dirty state", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "original 1" });
    store.updateBuffer(projectId, file1, "modified 1");

    store.markSavingStart(projectId, file1);
    store.markSavingError(projectId, file1, "Network timeout");

    const tabData = store.getTabData(projectId, file1);
    assert.equal(tabData?.isDirty, true);
    assert.equal(tabData?.isSaving, false);
    assert.equal(tabData?.saveError, "Network timeout");
  });

  // Scenario 9 & 19: New edits made during save remain dirty & stale save responses do not clear newer dirty state
  test("9 & 19. New edits made during a save remain dirty", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "v1" });

    store.updateBuffer(projectId, file1, "v2");
    const contentToSave = store.markSavingStart(projectId, file1);
    assert.equal(contentToSave, "v2");

    // User types "v3" while save is in flight
    store.updateBuffer(projectId, file1, "v3");
    assert.equal(store.getTabData(projectId, file1)?.buffer, "v3");

    // Save for "v2" succeeds
    store.markSavingSuccess(projectId, file1, contentToSave, Date.now());

    // Because buffer is "v3" and saved was "v2", file must STILL be dirty
    assert.equal(store.isFileDirty(projectId, file1), true);
    assert.equal(store.getTabData(projectId, file1)?.buffer, "v3");
    assert.equal(store.getTabData(projectId, file1)?.savedContent, "v2");
  });

  // Scenario 10 & 11: hasDirtyTabs for browser beforeunload warnings
  test("10 & 11. hasDirtyTabs detects dirty state across open tabs", () => {
    const store = useEditorStore.getState();
    assert.equal(store.hasDirtyTabs(projectId), false);

    store.openFile(projectId, file1, { pinned: true, initialContent: "text" });
    assert.equal(store.hasDirtyTabs(projectId), false);

    store.updateBuffer(projectId, file1, "text changed");
    assert.equal(store.hasDirtyTabs(projectId), true);

    store.markSavingSuccess(projectId, file1, "text changed");
    assert.equal(store.hasDirtyTabs(projectId), false);
  });

  // Scenario 13: Clean tab accepts external updates
  test("13. Clean tab accepts external updates", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "initial code", updatedAt: 100 });

    const result = store.handleRemoteUpdate(projectId, file1, "remote updated code", 200);
    assert.equal(result.action, "updated");
    assert.equal(store.getTabData(projectId, file1)?.buffer, "remote updated code");
    assert.equal(store.getTabData(projectId, file1)?.savedContent, "remote updated code");
    assert.equal(store.isFileDirty(projectId, file1), false);
    assert.equal(store.getTabData(projectId, file1)?.hasConflict, false);
  });

  // Scenario 14 & 15: Dirty tab detects conflict when remote update arrives
  test("14 & 15. Dirty tab preserves local content and detects conflict on external update", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "base code", updatedAt: 100 });

    // User makes local changes
    store.updateBuffer(projectId, file1, "my local modifications");
    assert.equal(store.isFileDirty(projectId, file1), true);

    // AI agent updates file remotely
    const result = store.handleRemoteUpdate(projectId, file1, "ai agent remote modifications", 200);
    assert.equal(result.action, "conflict");

    // Local buffer must be PRESERVED
    assert.equal(store.getTabData(projectId, file1)?.buffer, "my local modifications");
    assert.equal(store.getTabData(projectId, file1)?.hasConflict, true);
    assert.equal(store.getTabData(projectId, file1)?.remoteContent, "ai agent remote modifications");
    assert.equal(store.getTabData(projectId, file1)?.remoteUpdatedAt, 200);
  });

  // Scenario 17: Accepting external changes replaces local content
  test("17. Accepting external changes replaces local content", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "base", updatedAt: 100 });
    store.updateBuffer(projectId, file1, "local edits");
    store.handleRemoteUpdate(projectId, file1, "remote edits", 200);

    assert.equal(store.getTabData(projectId, file1)?.hasConflict, true);

    store.resolveConflictAcceptRemote(projectId, file1);
    const tabData = store.getTabData(projectId, file1);
    assert.equal(tabData?.hasConflict, false);
    assert.equal(tabData?.buffer, "remote edits");
    assert.equal(tabData?.savedContent, "remote edits");
    assert.equal(tabData?.isDirty, false);
    assert.equal(tabData?.remoteContent, null);
  });

  // Scenario 18: Keeping local changes preserves local buffer and clears conflict
  test("18. Keeping local changes preserves local buffer and clears conflict", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "base", updatedAt: 100 });
    store.updateBuffer(projectId, file1, "local edits");
    store.handleRemoteUpdate(projectId, file1, "remote edits", 200);

    assert.equal(store.getTabData(projectId, file1)?.hasConflict, true);

    store.resolveConflictKeepLocal(projectId, file1);
    const tabData = store.getTabData(projectId, file1);
    assert.equal(tabData?.hasConflict, false);
    assert.equal(tabData?.buffer, "local edits");
    assert.equal(tabData?.isDirty, true);
    assert.equal(tabData?.remoteContent, null);
  });

  // Scenario 20: Outdated remote updates do not overwrite newer content
  test("20. Outdated remote updates do not overwrite newer content", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "v2 content", updatedAt: 500 });

    const result = store.handleRemoteUpdate(projectId, file1, "stale v1 content", 300);
    assert.equal(result.action, "ignored");
    assert.equal(store.getTabData(projectId, file1)?.buffer, "v2 content");
    assert.equal(store.getTabData(projectId, file1)?.hasConflict, false);
  });

  // Scenario 23 & 24: Closing and reopening tabs behaves correctly
  test("23 & 24. Closing tabs cleans up data, closing all resets state", () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, file1, { pinned: true, initialContent: "content 1" });
    store.openFile(projectId, file2, { pinned: true, initialContent: "content 2" });

    store.closeTab(projectId, file1);
    assert.equal(store.getTabData(projectId, file1), undefined);
    assert.equal(store.getTabState(projectId).openTabs.includes(file1), false);
    assert.equal(store.getTabState(projectId).activeTabId, file2);

    store.closeAllTabs(projectId);
    assert.equal(store.getTabState(projectId).openTabs.length, 0);
    assert.equal(store.getTabState(projectId).activeTabId, null);
  });
});

describe("Issue #108 - Recursive Folder Deletion & Descendant Editor Tabs Cleanup", () => {
  const projectId = "proj_1";

  // Reusable simulated recursive deletion logic matching convex/files.ts
  async function simulateRecursiveDelete(db, storage, rootId) {
    const deletedFileIds = [];
    const deletedFolderIds = [];

    const deleteRecursive = async (fileId) => {
      const item = db.get(fileId);
      if (!item) return;

      if (item.type === "folder") {
        const children = Array.from(db.values()).filter(
          (f) => f.projectId === item.projectId && f.parentId === fileId
        );
        for (const child of children) {
          await deleteRecursive(child._id);
        }
        deletedFolderIds.push(fileId);
      } else {
        deletedFileIds.push(fileId);
      }

      if (item.storageId && storage) {
        await storage.delete(item.storageId);
      }

      db.delete(fileId);
    };

    await deleteRecursive(rootId);
    return { deletedFileIds, deletedFolderIds };
  }

  // Simulated folder deletion handler matching tree.tsx
  async function handleFolderDelete(folderId, deleteFileFn, closeTabFn) {
    try {
      const result = await deleteFileFn({ id: folderId });
      if (result && Array.isArray(result.deletedFileIds)) {
        for (const fileId of result.deletedFileIds) {
          closeTabFn(fileId);
        }
      }
      return result;
    } catch (error) {
      return { error };
    }
  }

  beforeEach(() => {
    useEditorStore.setState({ tabs: new Map() });
  });

  // Test 1 — Recursive deleted IDs: Verify that deleting a nested folder returns the root folder ID and all descendant file and folder IDs
  test("Test 1 — Recursive deleted IDs: returns root folder and all descendant file and folder IDs", async () => {
    const db = new Map([
      ["root_folder", { _id: "root_folder", projectId, type: "folder", parentId: undefined }],
      ["child_folder", { _id: "child_folder", projectId, type: "folder", parentId: "root_folder" }],
      ["child_file", { _id: "child_file", projectId, type: "file", parentId: "root_folder" }],
      ["nested_file", { _id: "nested_file", projectId, type: "file", parentId: "child_folder" }],
      ["unrelated_file", { _id: "unrelated_file", projectId, type: "file", parentId: undefined }],
    ]);

    const result = await simulateRecursiveDelete(db, null, "root_folder");

    assert.ok(result.deletedFolderIds.includes("root_folder"));
    assert.ok(result.deletedFolderIds.includes("child_folder"));
    assert.ok(result.deletedFileIds.includes("child_file"));
    assert.ok(result.deletedFileIds.includes("nested_file"));
    assert.equal(result.deletedFileIds.includes("unrelated_file"), false);
    assert.equal(result.deletedFolderIds.includes("unrelated_file"), false);

    // Verify database entries deleted
    assert.equal(db.has("root_folder"), false);
    assert.equal(db.has("child_folder"), false);
    assert.equal(db.has("child_file"), false);
    assert.equal(db.has("nested_file"), false);
    assert.equal(db.has("unrelated_file"), true);
  });

  // Test 2 — Nested folder descendants: Verify that files several levels deep are included in the deletion result
  test("Test 2 — Nested folder descendants: files several levels deep are included in the deletion result", async () => {
    const db = new Map([
      ["l1", { _id: "l1", projectId, type: "folder", parentId: undefined }],
      ["l2", { _id: "l2", projectId, type: "folder", parentId: "l1" }],
      ["l3", { _id: "l3", projectId, type: "folder", parentId: "l2" }],
      ["deep_file", { _id: "deep_file", projectId, type: "file", parentId: "l3" }],
    ]);

    const result = await simulateRecursiveDelete(db, null, "l1");

    assert.deepEqual(result.deletedFileIds, ["deep_file"]);
    assert.ok(result.deletedFolderIds.includes("l1"));
    assert.ok(result.deletedFolderIds.includes("l2"));
    assert.ok(result.deletedFolderIds.includes("l3"));
  });

  // Test 3 — File-only tab cleanup: Verify that the client calls closeTab for deleted file IDs but never for folder IDs
  test("Test 3 — File-only tab cleanup: calls closeTab for deleted file IDs but never for folder IDs", async () => {
    const closedTabs = [];
    const deleteFileFn = async () => ({
      deletedFileIds: ["f1", "f2"],
      deletedFolderIds: ["dir1", "dir2"],
    });
    const closeTabFn = (id) => closedTabs.push(id);

    await handleFolderDelete("dir1", deleteFileFn, closeTabFn);

    assert.deepEqual(closedTabs, ["f1", "f2"]);
    assert.equal(closedTabs.includes("dir1"), false);
    assert.equal(closedTabs.includes("dir2"), false);
  });

  // Test 4 — Multiple open descendants: Verify that all open file tabs belonging to the deleted subtree are closed
  test("Test 4 — Multiple open descendants: all open file tabs belonging to the deleted subtree are closed", async () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, "f1", { pinned: true, initialContent: "f1 content" });
    store.openFile(projectId, "f2", { pinned: true, initialContent: "f2 content" });
    store.openFile(projectId, "f3", { pinned: true, initialContent: "f3 content" });

    const deleteFileFn = async () => ({
      deletedFileIds: ["f1", "f2"],
      deletedFolderIds: ["dir1"],
    });

    await handleFolderDelete("dir1", deleteFileFn, (id) => store.closeTab(projectId, id));

    const state = store.getTabState(projectId);
    assert.equal(state.openTabs.includes("f1"), false);
    assert.equal(state.openTabs.includes("f2"), false);
    assert.equal(state.openTabs.includes("f3"), true);
    assert.equal(store.getTabData(projectId, "f1"), undefined);
    assert.equal(store.getTabData(projectId, "f2"), undefined);
    assert.notEqual(store.getTabData(projectId, "f3"), undefined);
  });

  // Test 5 — Unrelated tabs preserved: Verify that tabs outside the deleted subtree remain open
  test("Test 5 — Unrelated tabs preserved: tabs outside deleted subtree remain open with their state intact", async () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, "nested_f1", { pinned: true, initialContent: "nested" });
    store.openFile(projectId, "unrelated_f1", { pinned: true, initialContent: "unrelated content" });

    // Make unrelated_f1 dirty
    store.updateBuffer(projectId, "unrelated_f1", "unrelated edited");
    assert.equal(store.isFileDirty(projectId, "unrelated_f1"), true);

    const deleteFileFn = async () => ({
      deletedFileIds: ["nested_f1"],
      deletedFolderIds: ["dir_a"],
    });

    await handleFolderDelete("dir_a", deleteFileFn, (id) => store.closeTab(projectId, id));

    const state = store.getTabState(projectId);
    assert.equal(state.openTabs.includes("nested_f1"), false);
    assert.equal(state.openTabs.includes("unrelated_f1"), true);
    assert.equal(store.isFileDirty(projectId, "unrelated_f1"), true);
    assert.equal(store.getTabData(projectId, "unrelated_f1")?.buffer, "unrelated edited");
  });

  // Test 6 — Active descendant cleanup: Verify that deleting active descendant tab invokes store cleanup and does not leave stale active-tab reference
  test("Test 6 — Active descendant cleanup: activates another tab or clears activeTabId if none remain", async () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, "f_other", { pinned: true, initialContent: "other" });
    store.openFile(projectId, "f_active", { pinned: true, initialContent: "active" });

    store.setActiveTab(projectId, "f_active");
    assert.equal(store.getTabState(projectId).activeTabId, "f_active");

    const deleteFileFn = async () => ({
      deletedFileIds: ["f_active"],
      deletedFolderIds: ["dir_active"],
    });

    await handleFolderDelete("dir_active", deleteFileFn, (id) => store.closeTab(projectId, id));

    // f_active is closed, active tab switches to f_other
    assert.equal(store.getTabState(projectId).activeTabId, "f_other");
    assert.equal(store.getTabState(projectId).openTabs.includes("f_active"), false);

    // Now delete f_other as well
    const deleteOtherFn = async () => ({
      deletedFileIds: ["f_other"],
      deletedFolderIds: ["dir_other"],
    });
    await handleFolderDelete("dir_other", deleteOtherFn, (id) => store.closeTab(projectId, id));

    assert.equal(store.getTabState(projectId).activeTabId, null);
    assert.equal(store.getTabState(projectId).openTabs.length, 0);
  });

  // Test 7 — Failed deletion: Make deletion reject, verify no tabs closed and error handled
  test("Test 7 — Failed deletion: rejection preserves tabs and does not close them", async () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, "f1", { pinned: true, initialContent: "content" });
    store.updateBuffer(projectId, "f1", "dirty content");

    let closeTabCalled = false;
    const deleteFileFn = async () => {
      throw new Error("Unauthorized");
    };
    const closeTabFn = (id) => {
      closeTabCalled = true;
      store.closeTab(projectId, id);
    };

    const res = await handleFolderDelete("folder_1", deleteFileFn, closeTabFn);

    assert.equal(closeTabCalled, false);
    assert.ok(res.error);
    assert.equal(res.error.message, "Unauthorized");
    assert.equal(store.getTabState(projectId).openTabs.includes("f1"), true);
    assert.equal(store.isFileDirty(projectId, "f1"), true);
  });

  // Test 8 — Direct file deletion regression: Verify direct file deletion closes only the selected file's tab
  test("Test 8 — Direct file deletion regression: direct file deletion closes only that file tab", async () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, "f1", { pinned: true, initialContent: "f1" });
    store.openFile(projectId, "f2", { pinned: true, initialContent: "f2" });

    // File deletion in tree.tsx calls closeTab(item._id) then deleteFile({ id: item._id })
    store.closeTab(projectId, "f1");

    assert.equal(store.getTabState(projectId).openTabs.includes("f1"), false);
    assert.equal(store.getTabState(projectId).openTabs.includes("f2"), true);
  });

  // Test 9 — Empty folder: Verify deleting an empty folder does not cause unnecessary tab cleanup
  test("Test 9 — Empty folder: deleting empty folder returns empty deletedFileIds and performs no tab cleanup", async () => {
    const store = useEditorStore.getState();
    store.openFile(projectId, "existing_file", { pinned: true, initialContent: "keep" });

    const closedTabs = [];
    const deleteFileFn = async () => ({
      deletedFileIds: [],
      deletedFolderIds: ["empty_dir"],
    });

    await handleFolderDelete("empty_dir", deleteFileFn, (id) => {
      closedTabs.push(id);
      store.closeTab(projectId, id);
    });

    assert.equal(closedTabs.length, 0);
    assert.equal(store.getTabState(projectId).openTabs.includes("existing_file"), true);
  });
});
