// `next/link` no modo estático: âncora real (abre em nova aba, copia link) que,
// no clique simples, navega pelo roteador próprio sem recarregar a página.

import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { isExternal, navigate, toBrowserUrl } from "@/static/runtime/navigation";

type Href = string | { pathname?: string; query?: Record<string, string | number | undefined>; hash?: string };

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: Href;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
  children?: ReactNode;
}

function hrefToString(href: Href): string {
  if (typeof href === "string") return href;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(href.query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return `${href.pathname ?? ""}${query ? `?${query}` : ""}${href.hash ? `#${href.hash}` : ""}`;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, replace, scroll, prefetch: _prefetch, onClick, target, children, ...rest },
  ref,
) {
  const target_ = hrefToString(href);
  const external = isExternal(target_);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || external) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (target && target !== "_self") return;
    event.preventDefault();
    navigate(target_, { replace, scroll });
  }

  return (
    <a
      ref={ref}
      href={external ? target_ : toBrowserUrl(target_)}
      target={target}
      onClick={handleClick}
      {...rest}
    >
      {children}
    </a>
  );
});

export default Link;
