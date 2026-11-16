"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import "./office-scene.css";

export type OfficeAgent = {
  id: string; name: string; department: string;
  status: "working" | "queued" | "ready" | "unknown";
  pending: number | null; completed: number | null; queue: number | null; lastJob?: string;
};
const labels = { working: "Trabalhando", queued: "Na fila", ready: "Disponível", unknown: "Sem leitura" };

export default function OfficeScene({ agents }: { agents: OfficeAgent[] }) {
  const [selected, setSelected] = useState(agents[0]?.id);
  const [yaw, setYaw] = useState(-32);
  const [tilt, setTilt] = useState(55);
  const [zoom, setZoom] = useState(1);
  const [scale, setScale] = useState(0.65);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; tilt: number } | null>(null);
  const agent = agents.find(a => a.id === selected) ?? agents[0];
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(0.88, entry.contentRect.width / 1300, entry.contentRect.height / 760)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const columns = agents.length > 9 ? 4 : 3;
  const rows = Math.max(2, Math.ceil(agents.length / columns));
  return <section className="office3d" aria-label="Escritório 3D interativo">
    <div className="office3d-world">
      <div className="office3d-toolbar"><span className="eyebrow">ESCRITÓRIO AO VIVO</span><div>
        <button type="button" aria-label="Girar para a esquerda" onClick={() => setYaw(yaw - 15)}>↶</button>
        <button type="button" aria-label="Girar para a direita" onClick={() => setYaw(yaw + 15)}>↷</button>
        <button type="button" aria-label="Diminuir zoom" disabled={zoom <= .7} onClick={() => setZoom(Math.max(.7, zoom - .15))}>−</button>
        <button type="button" aria-label="Aumentar zoom" disabled={zoom >= 1.8} onClick={() => setZoom(Math.min(1.8, zoom + .15))}>+</button>
        <button type="button" className="office3d-reset" onClick={() => { setYaw(-32); setTilt(55); setZoom(1); }}>Centralizar</button>
      </div></div>
      <div className="office3d-stage" ref={stage} role="group" aria-label="Arraste para girar o escritório. Selecione uma mesa para ver o agente."
        onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, yaw, tilt }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { const d = drag.current; if (d) { setYaw(d.yaw + (e.clientX - d.x) * .35); setTilt(Math.max(30, Math.min(70, d.tilt - (e.clientY - d.y) * .2))); } }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        style={{ "--camera-yaw": `${yaw}deg`, "--camera-tilt": `${tilt}deg`, "--camera-scale": scale * zoom } as CSSProperties}>
        <div className="office3d-room" style={{ "--room-depth": `${rows * 180 + 140}px`, "--room-width": `${columns * 210 + 100}px` } as CSSProperties}>
          <div className="office3d-floor" />
          <div className="office3d-wall back"><span>BIELENKI / JARVIS</span></div>
          <div className="office3d-wall side" />
          <div className="office3d-rug" />
          <div className="office3d-reception"><span>JARVIS</span><i /></div>
          {agents.map((a, i) => <button type="button" key={a.id} className={`office3d-station ${a.status}${a.id === agent?.id ? " selected" : ""}`}
            style={{ left: `${60 + i % columns * 210}px`, top: `${70 + Math.floor(i / columns) * 180}px` }}
            onPointerDown={e => e.stopPropagation()} onClick={() => setSelected(a.id)} aria-label={`Selecionar ${a.name}: ${labels[a.status]}`} aria-pressed={a.id === agent?.id}>
            <span className="office3d-desk"><i className="desk-top" /><i className="desk-front" /><i className="desk-side" /><i className="desk-leg one" /><i className="desk-leg two" /></span>
            <span className="office3d-monitor"><i /><b /></span>
            <span className="office3d-chair" />
            <span className="office3d-person"><i className="person-body" /><i className="person-head" /><i className="person-hair" /></span>
            <span className="office3d-agent-label"><i />{a.name}</span>
          </button>)}
        </div>
      </div>
      <p className="office3d-help">Arraste para explorar · Toque em um agente para acompanhar</p>
      <div className="office3d-agent-picker" aria-label="Selecionar agente">{agents.map(a => <button key={a.id} type="button" aria-pressed={a.id === agent?.id} onClick={() => setSelected(a.id)}><span className={`office3d-picker-dot ${a.status}`} />{a.name}</button>)}</div>
    </div>
    {agent && <aside className="office3d-detail" aria-live="polite">
      <span className="eyebrow">ESTAÇÃO DE TRABALHO</span>
      <div className={`office3d-portrait ${agent.status}`}><span>{agent.name.slice(0, 1)}</span><i /></div>
      <h2>{agent.name}</h2><p className="muted small">{agent.department}</p>
      <span className={`office3d-badge ${agent.status}`}>{labels[agent.status]}</span>
      <dl><div><dt>Pendências</dt><dd>{agent.pending ?? "—"}</dd></div><div><dt>Na fila</dt><dd>{agent.queue ?? "—"}</dd></div><div><dt>Concluídas</dt><dd>{agent.completed ?? "—"}</dd></div></dl>
      {agent.lastJob ? <Link className="office3d-task" href={`/jobs/${agent.lastJob}`}>Abrir última tarefa ↗</Link> : <p className="muted small">As tarefas deste agente aparecerão aqui.</p>}
      <Link href="/tarefas" className="office3d-all">Ver todas as tarefas →</Link>
    </aside>}
  </section>;
}
