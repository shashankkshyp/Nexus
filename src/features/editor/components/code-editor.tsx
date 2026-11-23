import { useEffect, useMemo, useRef } from "react"
import { EditorView, keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

import { minimap } from "../extensions/minimap";
import { customTheme } from "../extensions/theme";
import { getLanguageExtension } from "../extensions/language-extension";
import { customSetup } from "../extensions/custom-setup";
import { suggestion } from "../extensions/suggestion";
import { quickEdit } from "../extensions/quick-edit";
import { selectionTooltip } from "../extensions/selection-tooltip";
import type { SelectedCodeContext } from "../extensions/selection-tooltip";
import type { Id } from "../../../../convex/_generated/dataModel";

interface Props {
  projectId: Id<"projects">;
  fileId: Id<"files">;
  fileName: string;
  filePath?: string;
  initialValue?: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  conversationId?: Id<"conversations">;
  onSelectedCode?: (context: SelectedCodeContext) => void;
}

export const CodeEditor = (props: Props) => {
  const projectId = props.projectId;
  const fileId = props.fileId;
  const fileName = props.fileName;
  const filePath = props.filePath;
  const initialValue = props.initialValue ?? "";
  const onChange = props.onChange;
  const onSave = props.onSave;
  const conversationId = props.conversationId;
  const onSelectedCode = props.onSelectedCode;
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onSaveRef = useRef(onSave);
  const onSelectedCodeRef = useRef(onSelectedCode);
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  useEffect(() => {
    onSelectedCodeRef.current = onSelectedCode;
  }, [onSelectedCode]);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const languageExtension = useMemo(() => {
    return getLanguageExtension(fileName)
  }, [fileName])

  // External document sync: update editor doc if initialValue changes externally
  // (e.g. conflict accepted or baseline loaded) and differs from editor doc
  useEffect(() => {
    const view = viewRef.current;
    if (view && initialValue !== undefined) {
      const currentDoc = view.state.doc.toString();
      if (currentDoc !== initialValue) {
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: initialValue },
        });
      }
    }
  }, [initialValue]);

  useEffect(() => {
    if (!editorRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          if (onSaveRef.current) {
            onSaveRef.current();
            return true;
          }
          return false;
        },
        preventDefault: true,
      },
    ]);

    const view = new EditorView({
      doc: initialValue,
      parent: editorRef.current,
      extensions: [
        saveKeymap,
        oneDark,
        customTheme,
        customSetup,
        languageExtension,
        suggestion(fileName),
        quickEdit(fileName),
        selectionTooltip(
          {
            projectId,
            fileId,
            fileName,
            filePath: filePath ?? fileName,
            conversationId: conversationIdRef.current,
          },
          (context) => onSelectedCodeRef.current?.(context),
        ),
        keymap.of([indentWithTab]),
        minimap(),
        indentationMarkers(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        })
      ],
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialValue is only used for initial document
  }, [languageExtension]);

  return (
    <div ref={editorRef} className="size-full pl-4 bg-background" />
  );
};