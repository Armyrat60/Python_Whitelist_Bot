"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { useGuild } from "@/hooks/use-guild";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

function guildIconUrl(guildId: string, icon: string | null) {
  if (!icon) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.webp?size=64`;
}

export function GuildSwitcher() {
  const { activeGuild, guilds, switchGuild } = useGuild();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="w-48 justify-between" />
        }
      >
        <div className="flex items-center gap-2 truncate">
          {activeGuild && (
            <Avatar size="sm">
              <AvatarImage
                src={guildIconUrl(activeGuild.id, activeGuild.icon) ?? undefined}
                alt={activeGuild.name}
              />
              <AvatarFallback>
                {activeGuild.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
          <span className="truncate text-xs">
            {activeGuild?.name ?? "Select server"}
          </span>
        </div>
        <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search server..." />
          <CommandList>
            <CommandEmpty>No servers found.</CommandEmpty>
            <CommandGroup>
              {guilds.map((guild) => (
                <CommandItem
                  key={guild.id}
                  data-checked={guild.id === activeGuild?.id || undefined}
                  onSelect={() => {
                    switchGuild(guild.id);
                    setOpen(false);
                  }}
                >
                  <Avatar size="sm">
                    <AvatarImage
                      src={guildIconUrl(guild.id, guild.icon) ?? undefined}
                      alt={guild.name}
                    />
                    <AvatarFallback>
                      {guild.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{guild.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
