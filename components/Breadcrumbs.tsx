import Link from "next/link";

export type Crumb = { label: string; href?: string };

/** Хлебные крошки: путь до текущей страницы, последний пункт — где вы сейчас */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Навигация" className="text-sm print:hidden">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-500">
        {items.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-slate-300">›</span>}
            {c.href && i < items.length - 1
              ? <Link href={c.href} className="truncate text-brand hover:underline">{c.label}</Link>
              : <span className="truncate text-slate-700" aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
