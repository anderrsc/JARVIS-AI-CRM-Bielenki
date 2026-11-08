"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polling curto: nenhuma chamada fica bloqueada esperando o Ollama.
export default function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return <p className="muted small" aria-live="polite">Atualizando automaticamente…</p>;
}
