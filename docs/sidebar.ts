import type { Config } from "vocs/config";
import { docsTree } from "./docs-tree.ts";
import { getDelta, type VersionKey, versions } from "./versions.ts";

type SidebarItem = Extract<
  NonNullable<Config["sidebar"]>,
  readonly unknown[]
>[number];
type Items = readonly SidebarItem[];

/**
 * Rewrite the canonical docs tree for an archived version: prefix every link
 * with the version segment, drop pages the version does not have, and apply
 * its renames.
 */
function forVersion(items: Items, key: Exclude<VersionKey, "latest">): Items {
  const { absent, renamed, order } = getDelta(key);
  const prefix = `/docs/${key}`;

  /** Apply this version's group ordering, if it differs from latest. */
  function reorder(children: Items, label: string | undefined): Items {
    const wanted = label === undefined ? undefined : order[label];
    if (wanted === undefined) return children;
    const rank = (item: SidebarItem) => {
      const index = item.link === undefined ? -1 : wanted.indexOf(item.link);
      return index === -1 ? wanted.length : index;
    };
    return [...children].sort((a, b) => rank(a) - rank(b));
  }

  return items.flatMap((item): SidebarItem[] => {
    if (item.items !== undefined) {
      const children = forVersion(reorder(item.items, item.text), key);
      // Drop a section that has been emptied out by the delta.
      if (children.length === 0) return [];
      return [{ ...item, items: [...children] }];
    }

    if (item.link === undefined) return [{ ...item }];
    if (absent.includes(item.link)) return [];

    const rename = renamed[item.link];
    const link = rename ? rename.slug : item.link;
    const text = rename ? rename.text : item.text;

    return [{ ...item, text, link: `${prefix}${link.slice("/docs".length)}` }];
  });
}

/**
 * Path-scoped sidebars, one per documentation version. Vocs picks the deepest
 * matching prefix for the current route, so `/docs/0.15/` wins over `/docs/`.
 */
export const sidebar = Object.fromEntries(
  versions.map((version) => [
    `${version.prefix}/`,
    version.key === "latest"
      ? [...docsTree]
      : [...forVersion(docsTree, version.key)],
  ]),
) satisfies NonNullable<Config["sidebar"]>;

export { getBestSubpathForVersion, getCanonicalSubpath } from "./versions.ts";
