"use client";

import { ChevronsUpDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Link, useRouter } from "vocs";
import { getBestSubpathForVersion, getVersion, versions } from "../versions";
import { cn } from "./utils";

/**
 * Documentation version switcher, rendered into Vocs' `SidebarHeader` slot.
 *
 * NOTE: Vocs renders `SidebarHeader` only in the desktop sidebar. Its
 * `MobileNav` renders the navigation tree, socials, and theme toggle, but no
 * slots — so there is currently no version switcher on mobile.
 */
export function VersionPicker() {
  const { path } = useRouter();
  const activeVersion = getVersion(path);

  if (activeVersion === undefined) return null;

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex flex-row items-center justify-between w-[calc(100%+24px)] py-[10px] px-[12px] -ml-[12px] -my-[4px] flex-grow rounded-lg cursor-pointer hover:bg-[var(--vocs-background-color-surfaceTint)]"
        >
          <VersionLabel
            label={activeVersion.label}
            patch={activeVersion.patch}
          />
          <ChevronsUpDown className="w-4 h-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          alignOffset={-1}
          className="z-50 w-[calc(var(--vocs-spacing-sidebar)-2*var(--vocs-spacing-sidebar-px)+26px)] bg-[var(--vocs-background-color-primary)] border border-[var(--vocs-border-color-primary)] text-[14px] font-medium rounded-lg flex flex-col shadow-lg"
        >
          {versions.map((toVersion, index) => (
            <DropdownMenu.Item
              key={toVersion.prefix}
              asChild
              className={cn(
                "pt-[10px] pb-[10px] px-[12px]",
                "hover:outline-none hover:bg-[var(--vocs-background-color-surfaceTint)]",
                "cursor-pointer",
                {
                  "rounded-t-md": index === 0,
                  "rounded-b-md": index === versions.length - 1,
                },
              )}
            >
              <Link to={getBestSubpathForVersion(path, toVersion.key)}>
                <VersionLabel label={toVersion.label} patch={toVersion.patch} />
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function VersionLabel({ label, patch }: { label: string; patch: string }) {
  return (
    <div className="flex flex-col items-start gap-1 leading-tight">
      <span className="text-[14px] font-medium">{label}</span>
      <span className="text-[11px] text-[var(--vocs-text-color-muted)] -mb-[2px]">
        {patch}
      </span>
    </div>
  );
}
