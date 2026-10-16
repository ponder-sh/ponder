"use client";

import { ChevronsUpDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Link, useRouter } from "vocs";
import { getBestSubpathForVersion } from "../sidebar";
import { cn } from "./utils";
import { getActiveVersion, versions } from "./versions";

export function VersionPicker({ className }: { className?: string }) {
  const { path } = useRouter();
  const activeVersion = getActiveVersion(path);

  if (!activeVersion) return null;

  return (
    <div className={className}>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flex w-[calc(100%+1.5rem)] flex-row items-center justify-between -mx-3 px-3 py-2 rounded-md cursor-pointer text-[var(--vocs-text-color-heading)] hover:bg-[var(--vocs-background-color-surfaceTint)]"
          >
            <VersionLabel
              label={activeVersion.label}
              patch={activeVersion.patch}
            />
            <ChevronsUpDown className="w-4 h-4 text-[var(--vocs-text-color-secondary)]" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 w-[var(--radix-dropdown-menu-trigger-width)] flex flex-col p-1 rounded-lg border border-[var(--vocs-border-color-primary)] bg-[var(--vocs-background-color-primary)] text-[var(--vocs-text-color-heading)] shadow-lg"
          >
            {versions.map((toVersion) => (
              <DropdownMenu.Item
                key={toVersion.prefix}
                asChild
                className={cn(
                  "px-2 py-2 rounded-md cursor-pointer outline-none",
                  "hover:bg-[var(--vocs-background-color-surfaceTint)] data-[highlighted]:bg-[var(--vocs-background-color-surfaceTint)]",
                )}
              >
                <Link
                  to={getBestSubpathForVersion(
                    path,
                    activeVersion.key,
                    toVersion.key,
                  )}
                >
                  <VersionLabel
                    label={toVersion.label}
                    patch={toVersion.patch}
                  />
                </Link>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function VersionLabel({ label, patch }: { label: string; patch: string }) {
  return (
    <div className="flex flex-col items-start gap-1 leading-tight">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[11px] text-[var(--vocs-text-color-secondary)]">
        {patch}
      </span>
    </div>
  );
}
