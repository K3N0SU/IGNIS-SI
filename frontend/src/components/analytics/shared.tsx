"use client";

import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { COLORS } from "@/lib/regimes";

export const tick = { fontSize: 10, fill: COLORS.muted };
export const axisLine = { stroke: COLORS.lineStrong };
export const axisTitle = { fontSize: 10.5, fill: COLORS.muted, fontFamily: "var(--font-sans)" };

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/** Fetches whenever `key` changes and keeps the previous result on screen while the next one loads. */
export function useFetch<T>(load: (signal: AbortSignal) => Promise<T>, key: string): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{ data: T | null; failed: boolean }>({ data: null, failed: false });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const ctl = new AbortController();
    loadRef
      .current(ctl.signal)
      .then((data) => setState({ data, failed: false }))
      .catch(() => {
        if (!ctl.signal.aborted) setState((s) => ({ ...s, failed: true }));
      });
    return () => ctl.abort();
  }, [key]);
  return state;
}

/** The one-sentence plain explanation every analytics panel carries. */
export function Explain({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-snug text-muted">{children}</p>;
}

export function LoadFailed() {
  return (
    <p className="px-3.5 py-3 text-[12px] text-muted" role="alert">
      This panel could not be loaded because the simulation service did not answer.
    </p>
  );
}

export function LegendKey({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted">
      <span
        className="w-3.5 border-t-2"
        style={{ borderColor: color, borderTopStyle: dashed ? "dashed" : "solid" }}
      />
      {label}
    </span>
  );
}
