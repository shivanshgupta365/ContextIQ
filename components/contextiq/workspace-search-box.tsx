"use client";

import type { Route } from "next";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

export function WorkspaceSearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    startTransition(() => {
      const query = value.trim();
      const params = new URLSearchParams();
      if (query) {
        params.set("q", query);
      }
      const nextHref = params.toString() ? `/command-center?${params.toString()}` : "/command-center";
      if (pathname === "/command-center" && nextHref === `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`) {
        return;
      }
      router.push(nextHref as Route);
    });
  };

  return (
    <div className="group relative">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#2563EB]"
      />
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Search context..."
        aria-label="Search workspace context"
        className="w-56 rounded-lg border border-transparent bg-slate-50 py-2 pl-9 pr-8 text-[14px] font-medium outline-none transition-all duration-300 placeholder:text-slate-400 hover:bg-slate-100 focus:w-72 focus:border-[#2563EB]/30 focus:bg-white focus:ring-2 focus:ring-[#2563EB]/5"
      />
      {isPending ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Go
        </span>
      ) : null}
    </div>
  );
}
