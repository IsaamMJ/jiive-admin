"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    setLoading(false);
    setWidth(0);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!loading) return;
    setWidth(30);
    const t1 = setTimeout(() => setWidth(60), 200);
    const t2 = setTimeout(() => setWidth(80), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loading]);

  // Intercept link clicks to trigger the bar
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#")) return;
      setLoading(true);
      setWidth(10);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  if (!loading && width === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 z-50 h-0.5 bg-primary transition-all duration-300 ease-out"
      style={{ width: `${width}%`, opacity: loading ? 1 : 0 }}
    />
  );
}
