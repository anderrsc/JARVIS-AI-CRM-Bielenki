"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { conversar, executarAcao, verResposta } from "./conversa-actions";
import { NAO, paraFala, SIM, TEXTO_MAX, type Turno } from "@/lib/conversa";

type Msg = Turno & { id: string; tarefa?: string; status?: "pensando" | "ok" | "erro"; fonte?: "dados" | "ia" | "acao"; agente?: string; pedido?: string };
type Estado = "pronto" | "ouvindo" | "pensando" | "falando";

// Web Speech API (Chrome, Edge, Safari). Tipos mínimos para não depender de lib externa.
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
};
const RecCtor = () => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const CHAVE = "jarvis.conversa.v1";
const POLL_MS = 2000;
const POLL_MAX = 120; // ~4 min
const nid = () => Math.random().toString(36).slice(2, 10);

function carregar(): Msg[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) || "[]");
    if (!Array.isArray(v)) return [];
    // Resposta que ficou pendente numa visita anterior: aponta para Tarefas em vez de girar para sempre.
    return (v as Msg[]).slice(-60).map((m) => m.status === "pensando"
      ? { ...m, status: "erro", texto: m.texto || "Resposta não acompanhada. Veja em Tarefas." } : m);
  } catch {
    return [];
  }
}

function escolherVoz(): SpeechSynthesisVoice | null {
  const vozes = speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("pt-br"));
  return vozes.find((v) => /daniel|antonio|ricardo|google/i.test(v.name)) ?? vozes[0] ?? null;
}

export default function Jarvis({ nome }: { nome: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [estado, setEstado] = useState<Estado>("pronto");
  const [texto, setTexto] = useState("");
  const [parcial, setParcial] = useState("");
  const [voz, setVoz] = useState(true);
  const [maosLivres, setMaosLivres] = useState(false);
  const [semMic, setSemMic] = useState(false);
  const [saud, setSaud] = useState("Olá");
  const nucleo = useRef<HTMLButtonElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const rec = useRef<Rec | null>(null);
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; an: AnalyserNode } | null>(null);
  const raf = useRef(0);
  const nivel = useRef(0);
  const refs = useRef({ voz, maosLivres, msgs });
  useEffect(() => { refs.current = { voz, maosLivres, msgs }; }, [voz, maosLivres, msgs]);

  const carregado = useRef(false);
  useEffect(() => {
    // Histórico e preferências ficam só neste navegador; lidos depois da hidratação.
    const t = setTimeout(() => {
      setMsgs(carregar());
      setSemMic(!RecCtor());
      try { setVoz(localStorage.getItem("jarvis.voz") !== "0"); } catch { /* ok */ }
      if ("speechSynthesis" in window) speechSynthesis.getVoices();
      const h = new Date().getHours();
      setSaud(h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite");
      carregado.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!carregado.current) return;
    try { localStorage.setItem(CHAVE, JSON.stringify(msgs.slice(-60))); } catch { /* ok */ }
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  // Animação do núcleo: nível de 0 a 1 em CSS var, sem re-render do React.
  const animar = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const buf = new Uint8Array(256);
    const passo = () => {
      let alvo = 0;
      const a = audio.current;
      if (a) {
        a.an.getByteTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += ((v - 128) / 128) ** 2;
        alvo = Math.min(1, Math.sqrt(s / buf.length) * 4);
      } else if (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking) {
        alvo = 0.35 + 0.3 * Math.abs(Math.sin(performance.now() / 110)) * Math.random();
      }
      nivel.current += (alvo - nivel.current) * 0.25;
      nucleo.current?.style.setProperty("--lvl", nivel.current.toFixed(3));
      raf.current = requestAnimationFrame(passo);
    };
    passo();
  }, []);
  useEffect(() => { animar(); return () => cancelAnimationFrame(raf.current); }, [animar]);

  const pararMic = useCallback(() => {
    const a = audio.current;
    audio.current = null;
    a?.stream.getTracks().forEach((t) => t.stop());
    a?.ctx.close().catch(() => {});
  }, []);

  const atualizar = (id: string, p: Partial<Msg>) => setMsgs((m) => m.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const falar = useCallback((t: string, depois?: () => void) => {
    if (!refs.current.voz || !("speechSynthesis" in window)) { setEstado("pronto"); depois?.(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(paraFala(t));
    u.lang = "pt-BR";
    const v = escolherVoz();
    if (v) u.voice = v;
    u.rate = 1.05;
    u.onstart = () => setEstado("falando");
    u.onend = u.onerror = () => { setEstado("pronto"); depois?.(); };
    speechSynthesis.speak(u);
  }, []);

  const ouvirRef = useRef<() => void>(() => {});

  // Mãos livres no celular: mantém a tela acesa enquanto a conversa estiver ativa.
  useEffect(() => {
    if (!maosLivres) return;
    type Lock = { release(): Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<Lock> } };
    let lock: Lock | null = null;
    const pedir = () => { if (document.visibilityState === "visible") nav.wakeLock?.request("screen").then((l) => { lock = l; }, () => {}); };
    pedir();
    document.addEventListener("visibilitychange", pedir);
    return () => { document.removeEventListener("visibilitychange", pedir); lock?.release().catch(() => {}); };
  }, [maosLivres]);
  // Ação aguardando confirmação: o pedido original é reenviado e recalculado no servidor.
  const [pendente, setPendente] = useState<{ pedido: string; msg: string } | null>(null);
  const pendenteRef = useRef(pendente);
  useEffect(() => { pendenteRef.current = pendente; }, [pendente]);
  const executando = useRef(false);

  const resolverAcao = useCallback(async (confirma: boolean) => {
    const p = pendenteRef.current;
    if (!p || executando.current) return;
    setPendente(null);
    pendenteRef.current = null;
    atualizar(p.msg, { pedido: undefined });
    const continuar = () => { if (refs.current.maosLivres) setTimeout(() => ouvirRef.current(), 400); };
    if (!confirma) {
      setMsgs((m) => [...m, { id: nid(), de: "jarvis", texto: "Cancelado. Nada foi feito.", status: "ok" }]);
      falar("Cancelado. Nada foi feito.", continuar);
      return;
    }
    executando.current = true;
    const rid = nid();
    setMsgs((m) => [...m, { id: rid, de: "jarvis", texto: "", status: "pensando" }]);
    setEstado("pensando");
    const r = await executarAcao(p.pedido).catch(() => ({ tipo: "erro", texto: "Sem conexão com o servidor. Nada foi confirmado." }) as const);
    executando.current = false;
    const texto = r.tipo === "texto" || r.tipo === "erro" ? r.texto : "Resposta inesperada. Confira em Hoje antes de repetir.";
    atualizar(rid, { texto, status: r.tipo === "texto" ? "ok" : "erro", fonte: "acao" });
    falar(texto, continuar);
  }, [falar]);

  const responder = useCallback(async (pergunta: string) => {
    const q = pergunta.trim().slice(0, TEXTO_MAX);
    if (q.length < 2) return;
    if (pendenteRef.current) {
      const resp = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (SIM.test(resp) || NAO.test(resp)) {
        setMsgs((m) => [...m, { id: nid(), de: "eu", texto: q }]);
        void resolverAcao(SIM.test(resp));
        return;
      }
      atualizar(pendenteRef.current.msg, { pedido: undefined });
      setPendente(null);
      pendenteRef.current = null;
    }
    const historico = refs.current.msgs.slice(-6).map(({ de, texto }) => ({ de, texto }));
    const rid = nid();
    setMsgs((m) => [...m, { id: nid(), de: "eu", texto: q }, { id: rid, de: "jarvis", texto: "", status: "pensando" }]);
    setEstado("pensando");
    const continuar = () => { if (refs.current.maosLivres) setTimeout(() => ouvirRef.current(), 400); };
    const r = await conversar(q, historico).catch(() => ({ tipo: "erro", texto: "Sem conexão com o servidor." }) as const);
    if (r.tipo === "erro") {
      atualizar(rid, { texto: r.texto, status: "erro" });
      setEstado("pronto");
      falar(r.texto);
      return;
    }
    if (r.tipo === "texto") {
      atualizar(rid, { texto: r.texto, status: "ok", fonte: "dados" });
      falar(r.texto, continuar);
      return;
    }
    if (r.tipo === "confirmar") {
      atualizar(rid, { texto: r.texto, status: "ok", fonte: "acao", pedido: q });
      setPendente({ pedido: q, msg: rid });
      falar(r.texto, continuar);
      return;
    }
    atualizar(rid, { tarefa: r.id, fonte: "ia", agente: r.agente });
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise((ok) => setTimeout(ok, POLL_MS));
      const s = await verResposta(r.id).catch(() => null);
      if (!s) continue;
      if (s.status === "completed" && s.texto) {
        atualizar(rid, { texto: s.texto, status: "ok" });
        falar(s.texto, continuar);
        return;
      }
      if (s.status === "failed" || s.status === "erro") {
        const t = s.texto && s.status === "erro" ? s.texto : "Não consegui concluir essa resposta. A tarefa ficou registrada em Tarefas.";
        atualizar(rid, { texto: t, status: "erro" });
        setEstado("pronto");
        return;
      }
    }
    atualizar(rid, { texto: "Ainda estou processando. A resposta vai aparecer em Tarefas.", status: "erro" });
    setEstado("pronto");
  }, [falar, resolverAcao]);

  const ouvir = useCallback(async () => {
    const Ctor = RecCtor();
    if (!Ctor) { setSemMic(true); return; }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    const r = new Ctor();
    r.lang = "pt-BR";
    r.interimResults = true;
    r.continuous = false;
    let final = "";
    r.onresult = (e) => {
      let tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript; else tmp += res[0].transcript;
      }
      setParcial(final + tmp);
    };
    r.onerror = (e) => { if (e.error === "not-allowed") setSemMic(true); };
    r.onend = () => {
      rec.current = null;
      pararMic();
      setParcial("");
      if (final.trim()) responder(final); else setEstado("pronto");
    };
    rec.current = r;
    setEstado("ouvindo");
    try {
      r.start();
    } catch {
      setEstado("pronto");
      return;
    }
    // Medidor de voz para o núcleo (opcional: se falhar, o reconhecimento segue).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!rec.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      audio.current = { ctx, stream, an };
    } catch { /* sem medidor */ }
  }, [pararMic, responder]);
  useEffect(() => { ouvirRef.current = ouvir; }, [ouvir]);

  const tocarNucleo = () => {
    if (estado === "ouvindo") { rec.current?.stop(); return; }
    if (estado === "falando") { speechSynthesis.cancel(); setEstado("pronto"); return; }
    if (estado === "pronto") ouvir();
  };

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (estado === "pensando" || !texto.trim()) return;
    // Destrava a voz no iPhone (precisa nascer de um toque).
    if (voz && "speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    responder(texto);
    setTexto("");
  };

  const alternarVoz = () => {
    const v = !voz;
    setVoz(v);
    if (!v && "speechSynthesis" in window) speechSynthesis.cancel();
    try { localStorage.setItem("jarvis.voz", v ? "1" : "0"); } catch { /* ok */ }
  };

  const ROTULO: Record<Estado, string> = { pronto: semMic ? "Digite sua mensagem" : "Toque no núcleo para falar", ouvindo: "Ouvindo…", pensando: "Processando…", falando: "Falando… toque para interromper" };

  return (
    <div className={`jv jv-${estado}${msgs.length ? " jv-compact" : ""}`}>
      <button type="button" className="jv-core" ref={nucleo} onClick={tocarNucleo} aria-label={ROTULO[estado]} disabled={estado === "pensando"}>
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle className="r r1" cx="100" cy="100" r="92" />
          <circle className="r r2" cx="100" cy="100" r="78" />
          <circle className="r r3" cx="100" cy="100" r="64" />
          <g className="ticks">{Array.from({ length: 36 }, (_, i) => <line key={i} x1="100" y1="4" x2="100" y2={i % 3 ? 10 : 14} transform={`rotate(${i * 10} 100 100)`} />)}</g>
        </svg>
        <span className="jv-orb" />
      </button>
      <p className="jv-status" aria-live="polite">{parcial || ROTULO[estado]}</p>

      <div className="jv-log" role="log" aria-live="polite">
        {msgs.length === 0 && (
          <p className="muted jv-hint">{saud}, {nome}. Pergunte, por exemplo: “o que tenho hoje?”, “quais cobranças estão atrasadas?”, “instalações pendentes”.</p>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`jv-msg ${m.de} ${m.status ? "st-" + m.status : ""}`}>
            {m.status === "pensando" && !m.texto ? <span className="dots"><i /><i /><i /></span> : m.texto}
            {m.pedido && pendente?.msg === m.id && (
              <span className="jv-acao">
                <button type="button" onClick={() => resolverAcao(true)}>Confirmar</button>
                <button type="button" className="secondary" onClick={() => resolverAcao(false)}>Cancelar</button>
              </span>
            )}
            {m.de === "jarvis" && (m.fonte || m.tarefa) && (
              <small className="muted">
                {m.fonte === "dados" ? "dados do CRM/cadastro" : m.fonte === "acao" ? "ação do JARVIS" : `resposta do ${m.agente ?? "agente JARVIS"}`}
                {m.tarefa && <> · <Link href={`/jobs/${m.tarefa}`}>tarefa</Link></>}
              </small>
            )}
          </div>
        ))}
        <div ref={fim} />
      </div>

      <form className="jv-input" onSubmit={enviar}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={TEXTO_MAX} placeholder="Fale ou digite…" aria-label="Mensagem para o JARVIS" enterKeyHint="send" />
        <button disabled={estado === "pensando" || !texto.trim()}>Enviar</button>
      </form>
      <div className="jv-opts small">
        <label><input type="checkbox" checked={voz} onChange={alternarVoz} /> Respostas faladas</label>
        {!semMic && <label><input type="checkbox" checked={maosLivres} onChange={(e) => setMaosLivres(e.target.checked)} /> Mãos livres</label>}
        <button type="button" className="link" onClick={() => { setMsgs([]); if ("speechSynthesis" in window) speechSynthesis.cancel(); }}>Limpar conversa</button>
      </div>
      {semMic && <p className="muted small">Reconhecimento de voz indisponível neste navegador; use Chrome, Edge ou Safari e permita o microfone.</p>}
    </div>
  );
}
