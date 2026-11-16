"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { paraFala } from "@/lib/conversa";

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
    const clean = paraFala(text);
    const cached = urls.current.get(clean);
    if (cached) { await play(cached, after); return; }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean }), signal: controller.signal });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "A voz está indisponível. Continue por texto.");
      }
      if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Sua sessão expirou. Entre novamente para ouvir as respostas.");
      const blob = await response.blob();
      if (id !== version.current) return;
      const url = URL.createObjectURL(blob);
      urls.current.set(clean, url);
      if (urls.current.size > 12) {
        const first = urls.current.keys().next().value!;
        URL.revokeObjectURL(urls.current.get(first)!);
        urls.current.delete(first);
      }
      setBusy(false);
      await play(url, after);
    } catch (e) {
      if (controller.signal.aborted || id !== version.current) return;
      setBusy(false);
      setError(e instanceof Error ? e.message : "Não foi possível gerar a voz.");
    }
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
