"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { paraFala } from "@/lib/conversa";
import { speechParts } from "@/lib/voice";

export function useJarvisVoice() {
  const player = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController | null>(null);
  const version = useRef(0);
  const urls = useRef(new Map<string, string>());
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    version.current++;
    request.current?.abort();
    if (player.current) {
      player.current.onended = null;
      player.current.pause();
    }
    setPlaying(false);
    setBusy(false);
  }, []);

  const play = useCallback(async (url: string, after?: () => void) => {
    const el = player.current;
    if (!el) return;
    setSource(url);
    el.src = url;
    el.onended = () => { setPlaying(false); after?.(); };
    el.onerror = () => { setPlaying(false); setError("Não foi possível reproduzir o áudio. Tente novamente."); };
    try { await el.play(); setPlaying(true); }
    catch { setPlaying(false); setError("Seu navegador pediu um toque: use o player abaixo para ouvir."); }
  }, []);

  const speak = useCallback(async (text: string, after?: () => void) => {
    stop();
    setError("");
    const id = version.current;
    const parts = speechParts(paraFala(text));
    const controller = new AbortController();
    request.current = controller;
    const prepare = async (part: string): Promise<{ url: string } | { error: unknown }> => {
      try {
      const cached = urls.current.get(part);
      if (cached) return { url: cached };
      const response = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: part }), signal: controller.signal });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "A voz está indisponível. Continue por texto.");
      }
      if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Sua sessão expirou. Entre novamente para ouvir as respostas.");
      const blob = await response.blob();
      if (id !== version.current) return { error: new Error("Interrompido") };
      const url = URL.createObjectURL(blob);
      urls.current.set(part, url);
      if (urls.current.size > 12) {
        const first = urls.current.keys().next().value!;
        URL.revokeObjectURL(urls.current.get(first)!);
        urls.current.delete(first);
      }
      return { url };
      } catch (error) { return { error }; }
    };
    const run = async (index: number, prepared?: ReturnType<typeof prepare>) => {
      setBusy(true);
      const result = await (prepared ?? prepare(parts[index]));
      if (controller.signal.aborted || id !== version.current) return;
      setBusy(false);
      if ("error" in result) { setError(result.error instanceof Error ? result.error.message : "Não foi possível gerar a voz."); return; }
      // Only one synthesis request at a time; prepare the next phrase during playback.
      const next = index + 1 < parts.length ? prepare(parts[index + 1]) : undefined;
      await play(result.url, () => {
        if (id !== version.current) return;
        if (next) void run(index + 1, next); else after?.();
      });
    };
    if (parts.length) await run(0);
  }, [play, stop]);

  const preview = useCallback(() => {
    stop(); setError(""); void play("/audio/jarvis-preview.mp3");
  }, [play, stop]);

  useEffect(() => {
    const cache = urls.current;
    return () => { version.current++; request.current?.abort(); cache.forEach(URL.revokeObjectURL); cache.clear(); };
  }, []);

  return { player, source, busy, playing, error, speak, stop, preview, setPlaying };
}
