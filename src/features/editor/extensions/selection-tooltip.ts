import { Tooltip, showTooltip, EditorView } from "@codemirror/view";
import { StateEffect, StateField, EditorState } from "@codemirror/state";
import { showQuickEditEffect, quickEditState } from "./quick-edit";

import type { Id } from "../../../../convex/_generated/dataModel";

export interface SelectedCodeContext {
  projectId: Id<"projects">;
  fileId: Id<"files">;
  fileName: string;
  filePath: string;
  selectedText: string;
  startLine: number;
  endLine: number;
  conversationId?: Id<"conversations">;
}

export const addSelectedCodeEffect =
  StateEffect.define<SelectedCodeContext>();

export const getLanguageIdentifier = (fileName: string): string => {
  const extension = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
    : "";
  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    css: "css",
    scss: "scss",
    html: "html",
    json: "json",
    md: "markdown",
    py: "python",
  };
  return languages[extension] ?? "";
};

export const formatSelectedCodeContext = (
  context: SelectedCodeContext,
): string => {
  if (!context.selectedText) return "";

  const lineRange =
    context.startLine === context.endLine
      ? `${context.startLine}`
      : `${context.startLine}-${context.endLine}`;
  const language = getLanguageIdentifier(context.fileName);

  let fenceLength = 3;
  const backtickRuns = context.selectedText.match(/`+/g) ?? [];
  for (const run of backtickRuns) {
    if (run.length >= fenceLength) fenceLength = run.length + 1;
  }
  const fence = "`".repeat(fenceLength);

  return [
    "Please help me with this selected code:",
    "",
    `File: ${context.filePath}`,
    `Lines: ${lineRange}`,
    "",
    "Selected code:",
    `${fence}${language}`,
    context.selectedText,
    fence,
  ].join("\n");
};

export const appendSelectedCodeToDraft = (
  draft: string,
  context: SelectedCodeContext,
): string => {
  const formatted = formatSelectedCodeContext(context);
  if (!formatted) return draft;
  if (!draft) return formatted;
  if (!draft.trim()) return formatted;

  if (draft.endsWith("\n\n")) return `${draft}${formatted}`;
  if (draft.endsWith("\n")) return `${draft}\n${formatted}`;
  return `${draft}\n\n${formatted}`;
};

interface TooltipMetadata {
  projectId: Id<"projects">;
  fileId: Id<"files">;
  fileName: string;
  filePath: string;
  conversationId?: Id<"conversations">;
}

const createTooltipForSelection = (
  state: EditorState,
  getView: () => EditorView | null,
  metadata: TooltipMetadata,
): readonly Tooltip[] => {
  const selection = state.selection.main;

  if (selection.empty) {
    return [];
  }

  const isQuickEditActive = state.field(quickEditState);
  if (isQuickEditActive) {
    return [];
  }

  return [
    {
      pos: selection.to,
      above: false,
      strictSide: false,
      create() {
        const dom = document.createElement("div");
        dom.className =
          "bg-popover text-popover-foreground z-50 rounded-sm border border-input p-1 shadow-md flex items-center gap-2 text-sm";

        const addToChatButton = document.createElement("button");
        addToChatButton.textContent = "Add to Chat";
        addToChatButton.type = "button";
        addToChatButton.setAttribute("aria-label", "Add selected code to chat");
        addToChatButton.className =
            "font-sans p-1 px-2 hover:bg-foreground/10 rounded-sm";

        const activateAddToChat = () => {
          const view = getView();
          if (!view) return;

          const currentSelection = view.state.selection.main;
          if (currentSelection.empty) return;

          const selectedText = view.state.doc.sliceString(
            currentSelection.from,
            currentSelection.to,
          );
          if (!selectedText) return;

          const startLine = view.state.doc.lineAt(currentSelection.from).number;
          const endPosition = view.state.doc.lineAt(currentSelection.to);
          const endLine =
            currentSelection.to > currentSelection.from &&
            currentSelection.to === endPosition.from &&
            endPosition.number > 1
              ? endPosition.number - 1
              : endPosition.number;
          view.dispatch({
            effects: addSelectedCodeEffect.of({
              ...metadata,
              selectedText,
              startLine,
              endLine,
            }),
          });
        };

        addToChatButton.onclick = (event) => {
          event.preventDefault();
          activateAddToChat();
        };
        
        const quickEditButton = document.createElement("button");
        quickEditButton.className =
          "font-sans p-1 px-2 hover:bg-foreground/10 rounded-sm flex items-center gap-1";

        const quickEditButtonText = document.createElement("span");
        quickEditButtonText.textContent = "Quick Edit";

        const quickEditButtonShortcut = document.createElement("span");
        quickEditButtonShortcut.textContent = "ctrl+K";
        quickEditButtonShortcut.className = "text-sm opacity-60";

        quickEditButton.appendChild(quickEditButtonText);
        quickEditButton.appendChild(quickEditButtonShortcut);

        quickEditButton.onclick = () => {
          const view = getView();
          if (view) {
            view.dispatch({
              effects: showQuickEditEffect.of(true),
            });
          }
        };

        dom.appendChild(addToChatButton);
        dom.appendChild(quickEditButton);

        return { dom };
      },
    }
  ]
}

const selectionTooltipField = (
  getView: () => EditorView | null,
  metadata: TooltipMetadata,
) => StateField.define<readonly Tooltip[]>({
  create(state) {
    return createTooltipForSelection(state, getView, metadata);
  },

  update(tooltips, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return createTooltipForSelection(transaction.state, getView, metadata);
    }
    for (const effect of transaction.effects) {
      if (effect.is(showQuickEditEffect)) {
        return createTooltipForSelection(transaction.state, getView, metadata);
      }
    }
    return tooltips;
  },

  provide: (field) => showTooltip.computeN(
    [field],
    (state) => state.field(field),
  ),
});

export const selectionTooltip = (
  metadata: TooltipMetadata,
  onSelection: (context: SelectedCodeContext) => void,
) => {
  let view: EditorView | null = null;
  const getView = () => view;

  return [
    selectionTooltipField(getView, metadata),
    EditorView.updateListener.of((update) => {
      view = update.view;
      for (const transactionEffect of update.transactions.flatMap(
        (transaction) => transaction.effects,
      )) {
        if (transactionEffect.is(addSelectedCodeEffect)) {
          onSelection(transactionEffect.value);
        }
      }
    }),
  ];
};