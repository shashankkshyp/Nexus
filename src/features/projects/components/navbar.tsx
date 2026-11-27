"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import { CloudCheckIcon, LoaderIcon, SettingsIcon } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { Poppins } from "next/font/google";
import { formatDistanceToNow } from "date-fns";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Id } from "../../../../convex/_generated/dataModel";
import { useProject, useRenameProject } from "../hooks/use-projects";
import { ProjectSettingsDialog } from "./project-settings-dialog";

const font = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

export const Navbar = ({
  projectId
}: {
  projectId: Id<"projects">;
}) => {
  const project = useProject(projectId);
  const renameProject = useRenameProject();

  const [isRenaming, setIsRenaming] = useState(false);
  const [isRenamePending, setIsRenamePending] = useState(false);
  const [name, setName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isCommittedRef = useRef(false);

  const handleStartRename = () => {
    if (!project) return;
    isCommittedRef.current = false;
    setName(project.name);
    setIsRenaming(true);
  };

  const handleSubmit = async () => {
    if (isCommittedRef.current || isRenamePending) return;
    isCommittedRef.current = true;

    if (!project) return;
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === project.name) {
      setIsRenaming(false);
      return;
    }

    setIsRenamePending(true);
    try {
      await renameProject({ id: projectId, name: trimmedName });
      setIsRenaming(false);
    } catch (error) {
      console.error(error);
      setName(project.name);
      toast.error(error instanceof Error ? error.message : "Unable to rename project");
    } finally {
      setIsRenamePending(false);
    }
  };

  const handleCancel = () => {
    if (isCommittedRef.current) return;
    isCommittedRef.current = true;
    if (project) {
      setName(project.name);
    }
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  return (
    <nav className="flex justify-between items-center gap-x-2 p-2 bg-sidebar border-b">
      <div className="flex items-center gap-x-2">
        <Breadcrumb>
          <BreadcrumbList className="gap-0!">
            <BreadcrumbItem>
              <BreadcrumbLink
                className="flex items-center gap-1.5"
                asChild
              >
                <Button
                  variant="ghost"
                  className="w-fit! p-1.5! h-7!"
                  asChild
                >
                  <Link href="/">
                    <Image
                      src="/logo.svg"
                      alt="Logo"
                      width={20}
                      height={20}
                    />
                    <span
                      className={cn(
                        "text-sm font-medium",
                        font.className,
                      )}
                    >
                      Nexus
                    </span>
                  </Link>
                </Button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="ml-0! mr-1" />
            <BreadcrumbItem>
              {isRenaming ? (
                <input
                  autoFocus
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={handleSubmit}
                  onKeyDown={handleKeyDown}
                  disabled={isRenamePending}
                  className="text-sm bg-transparent text-foreground outline-none focus:ring-1 focus:ring-inset focus:ring-ring font-medium max-w-40 truncate"
                />
              ) : (
                <BreadcrumbPage
                  onClick={handleStartRename}
                  className="text-sm cursor-pointer hover:text-primary font-medium max-w-40 truncate"
                >
                  {project?.name ?? "Loading..."}
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {project?.importStatus === "importing" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 cursor-default">
                <LoaderIcon className="size-4 text-muted-foreground animate-spin" />
                {project.importProgress && project.importProgress.totalFiles > 0 ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {project.importProgress.processedFiles} / {project.importProgress.totalFiles} (
                    {Math.min(
                      100,
                      Math.round(
                        (project.importProgress.processedFiles /
                          project.importProgress.totalFiles) *
                          100,
                      ),
                    )}
                    %)
                  </span>
                ) : null}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {project.importProgress && project.importProgress.totalFiles > 0
                ? `Importing repository: ${project.importProgress.processedFiles} / ${project.importProgress.totalFiles} files (${Math.min(
                    100,
                    Math.round(
                      (project.importProgress.processedFiles /
                        project.importProgress.totalFiles) *
                        100,
                    ),
                  )}%)`
                : "Importing repository..."}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <CloudCheckIcon className="size-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              Saved{" "}
              {project?.updatedAt 
                ? formatDistanceToNow(
                  project.updatedAt,
                  { addSuffix: true, }
                )
                : "Loading..."}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground hover:text-foreground"
          title="Project settings"
          aria-label="Project settings"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon className="size-4" />
        </Button>
        <UserButton />
      </div>
      <ProjectSettingsDialog
        projectId={projectId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </nav>
  )
};
