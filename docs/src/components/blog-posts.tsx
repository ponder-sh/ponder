import { Link } from "vocs";

type Frontmatter = { title?: string; description?: string; date?: string };

const frontmatters = import.meta.glob<Frontmatter>(
  ["../pages/blog/*.mdx", "!../pages/blog/index.mdx"],
  { eager: true, import: "frontmatter" },
);

const posts = Object.entries(frontmatters)
  .map(([file, frontmatter]) => ({
    ...frontmatter,
    href: `/blog/${file
      .split("/")
      .pop()!
      .replace(/\.mdx$/, "")}`,
  }))
  .sort((a, b) => Date.parse(b.date ?? "") - Date.parse(a.date ?? ""));

export function BlogPosts() {
  return (
    <div className="min-h-[calc(100vh-var(--vocs-spacing-topNav)-300px)]">
      {posts.map((post, index) => (
        <div key={post.href}>
          {index > 0 && (
            <hr className="my-8 border-[var(--vocs-border-color-primary)]" />
          )}
          <Link to={post.href} className="block group">
            <h2 className="text-2xl text-[var(--vocs-text-color-heading)] group-hover:underline">
              {post.title}
            </h2>
            <div className="mt-1 text-sm text-[var(--vocs-text-color-secondary)]">
              {post.date}
            </div>
            <p className="mt-6 text-[var(--vocs-text-color-primary)]">
              {post.description} <span>[→]</span>
            </p>
          </Link>
        </div>
      ))}
    </div>
  );
}
