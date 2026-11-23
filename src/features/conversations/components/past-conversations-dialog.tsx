"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { PencilIcon, CheckIcon, XIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  useConversations,
  useRenameConversation,
  useDeleteConversation,
} from "../hooks/use-conversations";

import { Id, Doc } from "../../../../convex/_generated/dataModel";

interface PastConversationsDialogProps {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (conversationId: Id<"conversations">) => void;
  onDeleted?: (deletedConversationId: Id<"conversations">) => void;
}

export const PastConversationsDialog = ({
  projectId,
  open,
  onOpenChange,
  onSelect,
  onDeleted,
}: PastConversationsDialogProps) => {
  const conversations = useConversations(projectId);
  const renameConversation = useRenameConversation();
  const deleteConversation = useDeleteConversation();

  const [editingId, setEditingId] = useState<Id<"conversations"> | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  // Deletion state
  const [deletingConversation, setDeletingConversation] =
    useState<Doc<"conversations"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSelect = (conversationId: Id<"conversations">) => {
    onSelect(conversationId);
    onOpenChange(false);
  };

  const handleStartRename = (
    e: React.MouseEvent,
    conversation: Doc<"conversations">,
  ) => {
    e.stopPropagation();
    setEditingId(conversation._id);
    setEditTitle(conversation.title);
  };

  const handleCancelRename = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    if (isRenaming) return;
    setEditingId(null);
    setEditTitle("");
  };

  const handleSaveRename = async (
    e?: React.MouseEvent | React.FormEvent | React.KeyboardEvent,
    conversationId?: Id<"conversations">,
  ) => {
    e?.stopPropagation();
    const targetId = conversationId ?? editingId;
    if (!targetId || isRenaming) return;

    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      toast.error("Conversation title cannot be empty");
      return;
    }

    setIsRenaming(true);
    try {
      await renameConversation({
        conversationId: targetId,
        title: trimmedTitle,
      });
      toast.success("Conversation renamed successfully");
      setEditingId(null);
      setEditTitle("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to rename conversation";
      toast.error(message);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleOpenDelete = (
    e: React.MouseEvent,
    conversation: Doc<"conversations">,
  ) => {
    e.stopPropagation();
    setDeletingConversation(conversation);
  };

  const handleCancelDelete = () => {
    if (isDeleting) return;
    setDeletingConversation(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingConversation || isDeleting) return;

    const targetId = deletingConversation._id;
    setIsDeleting(true);
    try {
      await deleteConversation({
        conversationId: targetId,
      });
      toast.success("Conversation deleted successfully");
      setDeletingConversation(null);
      onDeleted?.(targetId);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to delete conversation";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setEditingId(null);
            setEditTitle("");
          }
          onOpenChange(nextOpen);
        }}
        title="Past Conversations"
        description="Search and select a past conversation"
      >
        <CommandInput placeholder="Search conversations..." />
        <CommandList>
          <CommandEmpty>No conversations found.</CommandEmpty>
          <CommandGroup heading="Conversations">
            {conversations?.map((conversation) => {
              const isEditing = editingId === conversation._id;

              return (
                <CommandItem
                  key={conversation._id}
                  value={`${conversation.title}-${conversation._id}`}
                  onSelect={() => {
                    if (!isEditing && !deletingConversation) {
                      handleSelect(conversation._id);
                    }
                  }}
                  className="group flex items-center justify-between"
                >
                  {isEditing ? (
                    <div
                      className="flex items-center gap-1.5 w-full py-0.5"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        disabled={isRenaming}
                        autoFocus
                        aria-label="Conversation title"
                        className="h-7 text-sm py-1 px-2"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSaveRename(e, conversation._id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            handleCancelRename(e);
                          }
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Save conversation title"
                        title="Save"
                        disabled={isRenaming || !editTitle.trim()}
                        onClick={(e) => handleSaveRename(e, conversation._id)}
                      >
                        {isRenaming ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : (
                          <CheckIcon className="size-3.5 text-primary" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Cancel renaming"
                        title="Cancel"
                        disabled={isRenaming}
                        onClick={handleCancelRename}
                      >
                        <XIcon className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-0.5 truncate pr-2">
                        <span className="truncate">{conversation.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(conversation._creationTime, {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Rename ${conversation.title}`}
                          title="Rename conversation"
                          className="size-6 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-opacity"
                          onClick={(e) => handleStartRename(e, conversation)}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Delete ${conversation.title}`}
                          title="Delete conversation"
                          className="size-6 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-opacity"
                          onClick={(e) => handleOpenDelete(e, conversation)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <AlertDialog
        open={Boolean(deletingConversation)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isDeleting) {
            setDeletingConversation(null);
          }
        }}
      >
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;
              {deletingConversation?.title}&rdquo;? This will permanently remove
              this conversation and all of its messages and execution history.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              onClick={handleCancelDelete}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={handleConfirmDelete}
            >
              {isDeleting ? (
                <>
                  <Loader2Icon className="size-4 animate-spin mr-1.5" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
