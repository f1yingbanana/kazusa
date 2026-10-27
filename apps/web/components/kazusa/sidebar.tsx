"use client";

import { useState } from "react";
import {
  CircleAlertIcon,
  SearchIcon,
  Settings2Icon,
  SquarePenIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgents, useChats } from "@/hooks/use-kazusa";
import type { Agent } from "@kazusa/client";
import type { KazusaConfig } from "@/lib/kazusa/config-store";
import { cn } from "@/lib/utils";
import { AgentList } from "./agent-list";
import { ChatList } from "./chat-list";
import { ParticipantAvatar } from "./chat-avatar";
import { ConnectionStatus } from "./connection-status";

export type SidebarTab = "chats" | "agents";

export function Sidebar({
  config,
  tab,
  onTabChange,
  selectedChatId,
  pendingAgentId,
  onSelectChat,
  onMessageAgent,
  onNewGroup,
  onOpenSettings,
  className,
}: {
  config: KazusaConfig;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  selectedChatId: string | null;
  pendingAgentId: string | null;
  onSelectChat: (chatId: string) => void;
  onMessageAgent: (agent: Agent) => void;
  onNewGroup: () => void;
  onOpenSettings: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const agents = useAgents();
  const chats = useChats();
  const loadError = chats.error ?? agents.error;

  return (
    <aside
      aria-label="Conversations"
      className={cn(
        "flex h-dvh min-h-0 flex-col border-r bg-sidebar",
        className,
      )}
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight">Kazusa</h1>
          <ConnectionStatus baseUrl={config.baseUrl} />
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" onClick={onNewGroup} />
              }
            >
              <SquarePenIcon />
              <span className="sr-only">New group</span>
            </TooltipTrigger>
            <TooltipContent>New group</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onOpenSettings}
                />
              }
            >
              <Settings2Icon />
              <span className="sr-only">Connection settings</span>
            </TooltipTrigger>
            <TooltipContent>Connection settings</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as SidebarTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex flex-col gap-3 px-4 pb-3">
          <InputGroup className="bg-background">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                tab === "chats" ? "Search conversations" : "Search agents"
              }
              aria-label={
                tab === "chats" ? "Search conversations" : "Search agents"
              }
            />
          </InputGroup>
          <TabsList className="w-full">
            <TabsTrigger value="chats">Chats</TabsTrigger>
            <TabsTrigger value="agents">
              Agents
              {agents.agents.length > 0 ? (
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {agents.agents.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        {loadError ? (
          <div className="px-4 pb-3">
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>{"Can't reach the server"}</AlertTitle>
              <AlertDescription>
                <p>{loadError.message}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      void chats.reload();
                      void agents.reload();
                    }}
                  >
                    Retry
                  </Button>
                  <Button size="xs" variant="ghost" onClick={onOpenSettings}>
                    Settings
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <TabsContent
          value="chats"
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            loadError && !chats.chats.length && "hidden",
          )}
        >
          <ChatList
            chats={chats.chats}
            agentsById={agents.agentsById}
            userId={config.userId}
            isLoading={chats.isLoading}
            query={query}
            selectedChatId={selectedChatId}
            onSelect={onSelectChat}
            onBrowseAgents={() => onTabChange("agents")}
            onNewGroup={onNewGroup}
          />
        </TabsContent>
        <TabsContent
          value="agents"
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            loadError && !agents.agents.length && "hidden",
          )}
        >
          <AgentList
            agents={agents.agents}
            isLoading={agents.isLoading}
            query={query}
            pendingAgentId={pendingAgentId}
            onMessage={onMessageAgent}
          />
        </TabsContent>
      </Tabs>

      <footer className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
        <ParticipantAvatar participant={{ name: config.userName }} size="sm" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {config.userName}
          </span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {config.userId}
          </span>
        </div>
      </footer>
    </aside>
  );
}
