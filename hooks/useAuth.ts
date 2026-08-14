"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, clearToken, getAdminName, getAdminRole } from "@/lib/auth";
import api from "@/lib/api";

export function useAuth() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [router]);

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    clearToken();
    router.replace("/login");
  };

  return { ready, name: getAdminName(), role: getAdminRole(), logout };
}
