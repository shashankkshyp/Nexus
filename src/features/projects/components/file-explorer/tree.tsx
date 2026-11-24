import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ChevronRightIcon } from "lucide-react";
import { FileIcon, FolderIcon } from "@react-symbols/icons/utils";

import { cn } from "@/lib/utils";

import {
  useCreateFile,
  useCreateFolder,
  useFolderContents,
  useRenameFile,
  useDeleteFile,
  useFilePath,
} from "@/features/projects/hooks/use-files";
import { useEditor } from "@/features/editor/hooks/use-editor";

import { getItemPadding } from "./constants";
import { LoadingRow } from "./loading-row";
import { CreateInput } from "./create-input";
import { RenameInput } from "./rename-input";
import { TreeItemWrapper } from "./tree-item-wrapper";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";

export const Tree = ({
  item,
  level = 0,
  projectId,
  expandKey = 0,
}: {
  item: Doc<"files">;
  level?: number;
  projectId: Id<"projects">;
  expandKey?: number;
}) => {
  const [isOpen, setIsOpen] = useState(expandKey > 0 && item.type === "folder");
  const [isRenaming, setIsRenaming] = useState(false);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const lastProcessedExpandKeyRef = useRef(expandKey);

  useEffect(() => {
    if (expandKey > 0 && item.type === "folder" && expandKey !== lastProcessedExpandKeyRef.current) {
      lastProcessedExpandKeyRef.current = expandKey;
      setIsOpen(true);
    }
  }, [expandKey, item.type]);

  const renameFile = useRenameFile({
    projectId,
    parentId: item.parentId,
  });
  const deleteFile = useDeleteFile({
    projectId,
    parentId: item.parentId,
  });
  const createFile = useCreateFile();
  const createFolder = useCreateFolder();
  const filePathData = useFilePath(item._id);

  const { openFile, closeTab, activeTabId } = useEditor(projectId);

  const folderContents = useFolderContents({
    projectId,
    parentId: item._id,
    enabled: item.type === "folder" && isOpen,
  });

  const handleCopyPath = async () => {
    if (filePathData === undefined) {
      toast.error("Path is still loading");
      return;
    }

    if (!filePathData || filePathData.length === 0) {
      toast.error("Unable to resolve path");
      return;
    }

    const relativePath = filePathData.map((segment) => segment.name).join("/");

    if (!relativePath) {
      toast.error("Unable to resolve path");
      return;
    }

    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(relativePath);
      toast.success("Path copied to clipboard");
    } catch {
      toast.error("Failed to copy path to clipboard");
    }
  };

  const handleRename = async (newName: string) => {
    setIsRenaming(false);

    if (newName === item.name) {
      return;
    }

    try {
      await renameFile({ id: item._id, newName });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to rename item";
      toast.error(message);
    }
  };

  const handleCreate = async (name: string) => {
    setCreating(null);

    try {
      if (creating === "file") {
        await createFile({
          projectId,
          name,
          content: "",
          parentId: item._id,
        });
      } else {
        await createFolder({
          projectId,
          name,
          parentId: item._id,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create item";
      toast.error(message);
    }
  };

  const startCreating = (type: "file" | "folder") => {
    setIsOpen(true);
    setCreating(type);
  };

  if (item.type === "file") {
    const fileName = item.name;
    const isActive = activeTabId === item._id;

    if (isRenaming) {
      return (
        <RenameInput
          type="file"
          defaultValue={fileName}
          level={level}
          onSubmit={handleRename}
          onCancel={() => setIsRenaming(false)}
        />
      );
    }

    return (
      <TreeItemWrapper
        item={item}
        level={level}
        isActive={isActive}
        onClick={() => openFile(item._id, { pinned: false })}
        onDoubleClick={() => openFile(item._id, { pinned: true })}
        onRename={() => setIsRenaming(true)}
        onDelete={() => {
          closeTab(item._id);
          deleteFile({ id: item._id });
        }}
        onCopyPath={handleCopyPath}
      >
        <FileIcon fileName={fileName} autoAssign className="size-4" />
        <span className="truncate text-sm">{fileName}</span>
      </TreeItemWrapper>
    );
  }

  const folderName = item.name;

  const folderRender = (
    <>
      <div className="flex items-center gap-0.5">
        <ChevronRightIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground",
            isOpen && "rotate-90"
          )}
        />
        <FolderIcon folderName={folderName} className="size-4" />
      </div>
      <span className="truncate text-sm">{folderName}</span>
    </>
  );

  if (creating) {
    return (
      <>
        <button
          onClick={() => setIsOpen((value) => !value)}
          className="group flex items-center gap-1 h-5.5 hover:bg-accent/30 w-full"
          style={{ paddingLeft: getItemPadding(level, false) }}
        >
          {folderRender}
        </button>
        {isOpen && (
          <>
            {folderContents === undefined && <LoadingRow level={level + 1} />}
            <CreateInput
              type={creating}
              level={level + 1}
              onSubmit={handleCreate}
              onCancel={() => setCreating(null)}
            />
            {folderContents?.map((subItem) => (
              <Tree
                key={subItem._id}
                item={subItem}
                level={level + 1}
                projectId={projectId}
                expandKey={expandKey}
              />
            ))}
          </>
        )}
      </>
    );
  }

  if (isRenaming) {
    return (
      <>
        <RenameInput
          type="folder"
          defaultValue={folderName}
          isOpen={isOpen}
          level={level}
          onSubmit={handleRename}
          onCancel={() => setIsRenaming(false)}
        />
        {isOpen && (
          <>
            {folderContents === undefined && <LoadingRow level={level + 1} />}
            {folderContents?.map((subItem) => (
              <Tree
                key={subItem._id}
                item={subItem}
                level={level + 1}
                projectId={projectId}
                expandKey={expandKey}
              />
            ))}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <TreeItemWrapper
        item={item}
        level={level}
        onClick={() => setIsOpen((value) => !value)}
        onRename={() => setIsRenaming(true)}
        onDelete={() => {
          deleteFile({ id: item._id });
        }}
        onCopyPath={handleCopyPath}
        onCreateFile={() => startCreating("file")}
        onCreateFolder={() => startCreating("folder")}
      >
        {folderRender}
      </TreeItemWrapper>
      {isOpen && (
        <>
          {folderContents === undefined && <LoadingRow level={level + 1} />}
          {folderContents?.map((subItem) => (
            <Tree
              key={subItem._id}
              item={subItem}
              level={level + 1}
              projectId={projectId}
              expandKey={expandKey}
            />
          ))}
        </>
      )}
    </>
  );
};
