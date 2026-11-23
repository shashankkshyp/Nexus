// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  appendSelectedCodeToDraft,
  formatSelectedCodeContext,
  getLanguageIdentifier,
  type SelectedCodeContext,
} from "@/features/editor/extensions/selection-tooltip";

const context = (overrides: Partial<SelectedCodeContext> = {}): SelectedCodeContext => ({
  projectId: "proj_1" as SelectedCodeContext["projectId"],
  fileId: "file_1" as SelectedCodeContext["fileId"],
  fileName: "example.ts",
  filePath: "src/features/example.ts",
  selectedText: 'const value = "hello";',
  startLine: 12,
  endLine: 18,
  conversationId: "conv_1" as SelectedCodeContext["conversationId"],
  ...overrides,
});

describe("editor chat context", () => {
  it("preserves selected source and derives TypeScript formatting", () => {
    const formatted = formatSelectedCodeContext(context());
    expect(formatted).toContain("File: src/features/example.ts");
    expect(formatted).toContain("Lines: 12-18");
    expect(formatted).toContain("```typescript");
    expect(formatted).toContain('const value = "hello";');
  });

  it("uses a safe fence longer than backtick sequences", () => {
    const formatted = formatSelectedCodeContext(context({
      selectedText: "const template = ````value````;",
    }));
    expect(formatted).toContain("````typescript");
    expect(formatted).toContain("const template = ````value````;");
  });

  it("uses an empty language for unknown extensions", () => {
    expect(getLanguageIdentifier("README.custom")).toBe("");
  });

  it("supports single-line ranges and Unicode", () => {
    const formatted = formatSelectedCodeContext(context({
      fileName: "hello.py",
      selectedText: 'print("こんにちは 🌍")',
      startLine: 7,
      endLine: 7,
    }));
    expect(formatted).toContain("Lines: 7");
    expect(formatted).toContain("```python");
    expect(formatted).toContain('print("こんにちは 🌍")');
  });

  it("preserves drafts and appends cleanly", () => {
    expect(appendSelectedCodeToDraft("", context())).not.toBe("");
    expect(appendSelectedCodeToDraft("Please explain.", context()))
      .toMatch(/^Please explain\.\n\nPlease help me/);
  });

  it("does not insert empty selections", () => {
    expect(formatSelectedCodeContext(context({ selectedText: "" }))).toBe("");
  });
});
