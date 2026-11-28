import { useState } from "react"
import { toast } from "sonner"
import { ChevronRightIcon, CopyMinusIcon, FolderOpenIcon, FilePlusCornerIcon, FolderPlusIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

import { useProject } from "../../hooks/use-projects"
import { Id } from "../../../../../convex/_generated/dataModel"
import { 
  useCreateFile,
  useCreateFolder,
  useFolderContents
} from "../../hooks/use-files"
import { CreateInput } from "./create-input"
import { LoadingRow } from "./loading-row"
import { Tree } from "./tree"

export const FileExplorer = ({ 
  projectId
}: { 
  projectId: Id<"projects">
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [collapseKey, setCollapseKey] = useState(0);
  const [expandKey, setExpandKey] = useState(0);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);

  const project = useProject(projectId);
  const rootFiles = useFolderContents({
    projectId,
    enabled: isOpen,
  });

  const createFile = useCreateFile();
  const createFolder = useCreateFolder();
  const handleCreate = async (name: string) => {
    setCreating(null);

    try {
      if (creating === "file") {
        await createFile({
          projectId,
          name,
          content: "",
          parentId: undefined,
        });
      } else {
        await createFolder({
          projectId,
          name,
          parentId: undefined,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create item";
      toast.error(message);
    }
  };

  return (
    <div className="h-full bg-sidebar">
      <ScrollArea>
        <div className="group/project flex items-center h-5.5 bg-accent font-bold">
          <button
            type="button"
            onClick={() => setIsOpen((value) => !value)}
            aria-expanded={isOpen}
            aria-label={project?.name ? `${project.name} explorer` : "Project explorer"}
            className="flex-1 min-w-0 text-left flex items-center gap-0.5 h-full cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ChevronRightIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground",
                isOpen && "rotate-90"
              )}
            />
            <p className="text-xs uppercase line-clamp-1">
              {project?.name ?? "Loading..."}
            </p>
          </button>
          <div className="opacity-0 group-hover/project:opacity-100 focus-within:opacity-100 transition-none duration-0 flex items-center gap-0.5 ml-auto shrink-0 pr-1">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsOpen(true);
                setCreating("file");
              }}
              variant="highlight"
              size="icon-xs"
              aria-label="New file"
              title="New file"
            >
              <FilePlusCornerIcon className="size-3.5" />
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsOpen(true);
                setCreating("folder");
              }}
              variant="highlight"
              size="icon-xs"
              aria-label="New folder"
              title="New folder"
            >
              <FolderPlusIcon className="size-3.5" />
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsOpen(true);
                setExpandKey((prev) => prev + 1);
              }}
              variant="highlight"
              size="icon-xs"
              aria-label="Expand all folders"
              title="Expand all folders"
            >
              <FolderOpenIcon className="size-3.5" />
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setCollapseKey((prev) => prev + 1);
                setExpandKey(0);
              }}
              variant="highlight"
              size="icon-xs"
              aria-label="Collapse all folders"
              title="Collapse all folders"
            >
              <CopyMinusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        {isOpen && (
          <>
            {rootFiles === undefined && <LoadingRow level={0} />}
            {creating && (
              <CreateInput
                type={creating}
                level={0}
                onSubmit={handleCreate}
                onCancel={() => setCreating(null)}
              />
            )}
            {rootFiles?.map((item) => (
              <Tree
                key={`${item._id}-${collapseKey}`}
                item={item}
                level={0}
                projectId={projectId}
                expandKey={expandKey}
              />
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  )
}