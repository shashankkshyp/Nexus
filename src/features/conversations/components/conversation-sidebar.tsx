import ky from "ky";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { CopyIcon, HistoryIcon, LoaderIcon, PlusIcon, RotateCcwIcon } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";

import {
  useConversation,
  useConversations,
  useCreateConversation,
  useMessages,
  useExecutionEvents,
} from "../hooks/use-conversations";

import { Id } from "../../../../convex/_generated/dataModel";
import { DEFAULT_CONVERSATION_TITLE } from "../constants";
import { PastConversationsDialog } from "./past-conversations-dialog";
import { ExecutionActivityTimeline } from "./execution-activity-timeline";
import {
  appendSelectedCodeToDraft,
  type SelectedCodeContext,
} from "@/features/editor/extensions/selection-tooltip";

interface ConversationSidebarProps {
  projectId: Id<"projects">;
  selectedCodeContext?: SelectedCodeContext | null;
  onSelectedCodeConsumed?: () => void;
  onActiveConversationChange?: (
    conversationId: Id<"conversations"> | null,
  ) => void;
}

export const ConversationSidebar = ({
  projectId,
  selectedCodeContext,
  onSelectedCodeConsumed,
  onActiveConversationChange,
}: ConversationSidebarProps) => {
  const [input, setInput] = useState("");
  const [selectedConversationId, setSelectedConversationId] =
    useState<Id<"conversations"> | null>(null);

  const [pastConversationsOpen, setPastConversationsOpen] = useState(false);

  const createConversation = useCreateConversation();
  const conversations = useConversations(projectId);

  // If the currently selected conversation was deleted (or does not exist in conversations),
  // fall back to the first available conversation or null.
  const activeConversationId = (() => {
    if (selectedConversationId) {
      const exists = conversations?.some((c) => c._id === selectedConversationId);
      if (exists) return selectedConversationId;
    }
    return conversations?.[0]?._id ?? null;
  })();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    onActiveConversationChange?.(activeConversationId);
  }, [activeConversationId, onActiveConversationChange]);

  useEffect(() => {
    if (!selectedCodeContext) return;
    if (selectedCodeContext.projectId !== projectId) {
      onSelectedCodeConsumed?.();
      return;
    }
    if (
      selectedCodeContext.conversationId &&
      selectedCodeContext.conversationId !== activeConversationId
    ) {
      onSelectedCodeConsumed?.();
      return;
    }
    if (!activeConversationId) {
      onSelectedCodeConsumed?.();
      return;
    }

    setInput((currentDraft) => {
      const nextDraft = appendSelectedCodeToDraft(
        currentDraft,
        selectedCodeContext,
      );
      const cursorPosition = nextDraft.length;
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(cursorPosition, cursorPosition);
      });
      return nextDraft;
    });
    onSelectedCodeConsumed?.();
  }, [
    selectedCodeContext,
    projectId,
    activeConversationId,
    onSelectedCodeConsumed,
  ]);

  const activeConversation = useConversation(activeConversationId);
  const conversationMessages = useMessages(activeConversationId);
  const executionEvents = useExecutionEvents(activeConversationId);

  const isProcessing = conversationMessages?.some(
    (msg) => msg.status === "processing",
  );

  // Identify the latest completed assistant response index and its immediately preceding user prompt
  const latestCompletedAssistantInfo = (() => {
    if (!conversationMessages || conversationMessages.length === 0) return null;

    // Scan backwards from the end of the messages list to find the latest completed assistant message
    for (let i = conversationMessages.length - 1; i >= 0; i--) {
      const msg = conversationMessages[i];
      if (msg.role === "assistant") {
        if (msg.status === "completed") {
          // Find the immediately preceding user message in conversation order
          for (let j = i - 1; j >= 0; j--) {
            if (conversationMessages[j].role === "user") {
              return {
                assistantIndex: i,
                assistantId: msg._id,
                precedingUserPrompt: conversationMessages[j].content,
              };
            }
          }
          // Assistant message has no preceding user message
          return {
            assistantIndex: i,
            assistantId: msg._id,
            precedingUserPrompt: null,
          };
        }
        // If the latest assistant response is not completed (e.g. streaming, processing, or cancelled),
        // regeneration is not eligible
        return null;
      }
    }
    return null;
  })();

  const handleRegenerate = async (promptToResubmit: string) => {
    if (isProcessing) return;
    if (!activeConversationId) return;

    try {
      await ky.post("/api/messages", {
        json: {
          conversationId: activeConversationId,
          message: promptToResubmit,
        },
      });
    } catch {
      toast.error("Message failed to send");
    }
  };

  const handleCancel = async () => {
    try {
      await ky.post("/api/messages/cancel", {
        json: { projectId },
      });
    } catch {
      toast.error("Unable to cancel request");
    }
  };

  const isCreatingRef = useRef(false);
  const projectIdRef = useRef(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  const handleCreateConversation = async () => {
    if (isCreatingRef.current) return null;
    if (!projectIdRef.current) return null;

    isCreatingRef.current = true;
    try {
      const newConversationId = await createConversation({
        projectId: projectIdRef.current,
        title: DEFAULT_CONVERSATION_TITLE,
      });
      setSelectedConversationId(newConversationId);
      return newConversationId;
    } catch {
      toast.error("Unable to create new conversation");
      return null;
    } finally {
      isCreatingRef.current = false;
    }
  };

  const handleCreateConversationRef = useRef(handleCreateConversation);
  useEffect(() => {
    handleCreateConversationRef.current = handleCreateConversation;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Must be Ctrl+Shift+N or Cmd+Shift+N (case-insensitive for 'n' / 'N')
      const isMac = e.metaKey && !e.ctrlKey;
      const isWinLinux = e.ctrlKey && !e.metaKey;
      if ((isMac || isWinLinux) && e.shiftKey && (e.key === "n" || e.key === "N" || e.code === "KeyN")) {
        // Exclude editable targets
        const target = e.target as Element | null;
        if (target && typeof target.closest === "function") {
          const tagName = target.tagName?.toLowerCase();
          if (tagName === "input" || tagName === "textarea" || tagName === "select") {
            return;
          }
          const htmlTarget = target as HTMLElement;
          if (
            htmlTarget.isContentEditable ||
            htmlTarget.contentEditable === "true" ||
            htmlTarget.getAttribute?.("contenteditable") === "true" ||
            htmlTarget.closest?.("[contenteditable='true']") ||
            htmlTarget.closest?.("[contenteditable='']")
          ) {
            return;
          }
          if (target.closest(".cm-editor") || target.closest(".cm-content")) {
            return;
          }
        }

        e.preventDefault();
        handleCreateConversationRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleSubmit = async (message: PromptInputMessage) => {
    const trimmedMessage = message.text.trim();

    // Preserve the existing stop/cancel behavior while processing.
    if (isProcessing && !trimmedMessage) {
      await handleCancel();
      setInput("");
      return;
    }

    // Defensive guard against whitespace-only submissions.
    if (!trimmedMessage) {
      setInput("");
      return;
    }

    let conversationId = activeConversationId;

    if (!conversationId) {
      conversationId = await handleCreateConversation();
      if (!conversationId) return;
    }

    try {
      await ky.post("/api/messages", {
        json: {
          conversationId,
          message: trimmedMessage,
        },
      });
    } catch {
      toast.error("Message failed to send");
    }

    setInput("");
  };

  return (
    <>
      <PastConversationsDialog
        projectId={projectId}
        open={pastConversationsOpen}
        onOpenChange={setPastConversationsOpen}
        onSelect={setSelectedConversationId}
        onDeleted={(deletedId) => {
          if (selectedConversationId === deletedId) {
            const remaining = conversations?.filter((c) => c._id !== deletedId) ?? [];
            setSelectedConversationId(remaining[0]?._id ?? null);
          }
        }}
      />
      <div className="flex flex-col h-full bg-sidebar">
        <div className="h-8.75 flex items-center justify-between border-b">
          <div className="text-sm truncate pl-3">
            {activeConversation?.title ?? DEFAULT_CONVERSATION_TITLE}
          </div>
          <div className="flex items-center px-1 gap-1">
            <Button
              size="icon-xs"
              variant="highlight"
              aria-label="Past conversations"
              title="Past conversations"
              onClick={() => setPastConversationsOpen(true)}
            >
              <HistoryIcon className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="highlight"
              aria-label="New conversation"
              title="New conversation (Ctrl+Shift+N / Cmd+Shift+N)"
              onClick={handleCreateConversation}
            >
              <PlusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        <Conversation className="flex-1">
          <ConversationContent>
            {conversationMessages?.map((message, messageIndex) => {
              const messageEvents = (executionEvents ?? []).filter(
                (evt) => evt.messageId === message._id,
              );
              const isMsgProcessing = message.status === "processing";

              return (
                <Message key={message._id} from={message.role}>
                  <MessageContent>
                    {message.role === "assistant" && messageEvents.length > 0 && (
                      <ExecutionActivityTimeline
                        events={messageEvents}
                        isProcessing={isMsgProcessing}
                      />
                    )}

                    {isMsgProcessing ? (
                      message.content ? (
                        <div className="space-y-2">
                          <MessageResponse>{message.content}</MessageResponse>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse pt-1">
                            <span className="size-1.5 rounded-full bg-primary" />
                            <span>Generating response...</span>
                          </div>
                        </div>
                      ) : messageEvents.length === 0 ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <LoaderIcon className="size-4 animate-spin" />
                          <span>Thinking...</span>
                        </div>
                      ) : null
                    ) : message.status === "cancelled" ? (
                      <span className="text-muted-foreground italic">
                        Request cancelled
                      </span>
                    ) : (
                      <MessageResponse>{message.content}</MessageResponse>
                    )}
                  </MessageContent>
                  {message.role === "assistant" &&
                    message.status === "completed" &&
                    messageIndex === (conversationMessages?.length ?? 0) - 1 && (
                      <MessageActions>
                        {latestCompletedAssistantInfo &&
                          latestCompletedAssistantInfo.assistantId === message._id &&
                          latestCompletedAssistantInfo.precedingUserPrompt !== null && (
                            <MessageAction
                              onClick={() => {
                                if (latestCompletedAssistantInfo.precedingUserPrompt !== null) {
                                  handleRegenerate(latestCompletedAssistantInfo.precedingUserPrompt);
                                }
                              }}
                              disabled={isProcessing}
                              label="Regenerate"
                              tooltip="Regenerate"
                            >
                              <RotateCcwIcon className="size-3" />
                            </MessageAction>
                          )}
                        <MessageAction
                          onClick={() => {
                            navigator.clipboard.writeText(message.content);
                          }}
                          label="Copy"
                          tooltip="Copy"
                        >
                          <CopyIcon className="size-3" />
                        </MessageAction>
                      </MessageActions>
                    )}
                </Message>
              );
            })}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="p-3">
          <PromptInput onSubmit={handleSubmit} className="mt-2">
            <PromptInputBody>
              <PromptInputTextarea
                ref={textareaRef}
                placeholder="Ask Nexus anything..."
                onChange={(e) => setInput(e.target.value)}
                value={input}
                disabled={isProcessing}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit
                disabled={isProcessing ? false : !input.trim()}
                status={isProcessing ? "streaming" : undefined}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </>
  );
};
