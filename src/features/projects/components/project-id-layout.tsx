"use client";

import { Allotment } from "allotment";
import { cloneElement, isValidElement, useCallback, useState } from "react";

import { ConversationSidebar } from "@/features/conversations/components/conversation-sidebar";

import { Navbar } from "./navbar";
import { Id } from "../../../../convex/_generated/dataModel";
import type { SelectedCodeContext } from "@/features/editor/extensions/selection-tooltip";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 800;
const DEFAULT_CONVERSATION_SIDEBAR_WIDTH = 400;
const DEFAULT_MAIN_SIZE = 1000;

export const ProjectIdLayout = ({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId: Id<"projects">;
}) => {
  const [activeConversationId, setActiveConversationId] =
    useState<Id<"conversations"> | null>(null);
  const [selectedCodeContext, setSelectedCodeContext] =
    useState<SelectedCodeContext | null>(null);

  const handleSelectedCode = useCallback((context: SelectedCodeContext) => {
    if (context.projectId !== projectId) return;
    setSelectedCodeContext({
      ...context,
      conversationId:
        context.conversationId ?? activeConversationId ?? undefined,
    });
  }, [projectId, activeConversationId]);

  const childWithChatBridge = isValidElement<{
    projectId: Id<"projects">;
    conversationId?: Id<"conversations">;
    onSelectedCode?: (context: SelectedCodeContext) => void;
  }>(children)
    ? cloneElement(children, {
        projectId,
        conversationId: activeConversationId ?? undefined,
        onSelectedCode: handleSelectedCode,
      })
    : children;

  return (
    <div className="w-full h-screen flex flex-col">
      <Navbar projectId={projectId} />
      <div className="flex-1 flex overflow-hidden">
        <Allotment
          className="flex-1"
          defaultSizes={[
            DEFAULT_CONVERSATION_SIDEBAR_WIDTH,
            DEFAULT_MAIN_SIZE
          ]}
        >
          <Allotment.Pane
            snap
            minSize={MIN_SIDEBAR_WIDTH}
            maxSize={MAX_SIDEBAR_WIDTH}
            preferredSize={DEFAULT_CONVERSATION_SIDEBAR_WIDTH}
          >
            <ConversationSidebar
              projectId={projectId}
              selectedCodeContext={selectedCodeContext}
              onSelectedCodeConsumed={() => setSelectedCodeContext(null)}
              onActiveConversationChange={setActiveConversationId}
            />
          </Allotment.Pane>
          <Allotment.Pane>
            {childWithChatBridge}
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
};