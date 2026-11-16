"use client";

import { type CSSProperties, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

export function Panel({
  title,
  subtitle,
  help,
  right,
  children,
  className = "",
  bodyClassName = "",
  highlight = false,
}: {
  title: string;
  subtitle?: string;
  help?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  highlight?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className={`flex min-h-0 min-w-0 flex-col rounded-md border bg-panel transition-colors duration-300 ${
        highlight ? "border-muted" : "border-line"
      } ${className}`}
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line px-3.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="shrink-0 text-[13px] font-semibold text-fg">{title}</h2>
          {subtitle ? <p className="truncate text-[11.5px] text-muted">{subtitle}</p> : null}
          {help ? (
            <span className="self-center">
              <Help text={help} />
            </span>
          ) : null}
        </div>
        {right ? <div className="flex shrink-0 items-center gap-3">{right}</div> : null}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  testId,
  ariaLabel,
  block = false,
}: {
  value: T;
  options: { value: T; label: string; accent?: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  testId?: string;
  ariaLabel?: string;
  block?: boolean;
}) {
  return (
    <div
      className={`${block ? "flex w-full" : "inline-flex"} rounded-md border border-line bg-inset p-0.5`}
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap rounded-[4px] font-medium transition-colors ${block ? "flex-1" : ""} ${
              size === "sm" ? "h-[22px] px-2 text-[11px]" : "h-[26px] px-3 text-[12px]"
            } ${active ? "bg-line-strong text-fg" : "text-muted hover:text-fg"}`}
          >
            {o.accent ? (
              <span
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ backgroundColor: o.accent, opacity: active ? 1 : 0.55 }}
              />
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  hint,
  help,
  unit,
  value,
  min,
  max,
  step,
  digits,
  onChange,
  accent,
  testId,
}: {
  label: string;
  hint?: GlossaryKey;
  help?: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits: number;
  onChange: (value: number) => void;
  accent?: string;
  testId?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  const style = { "--fill": `${fill}%`, "--track-fill": accent ?? "#F3F4F6" } as CSSProperties;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[12px] text-muted" htmlFor={testId}>
          {hint ? (
            <Term k={hint}>{label}</Term>
          ) : help ? (
            <Tip text={help} className="cursor-help">
              {label}
            </Tip>
          ) : (
            label
          )}
        </label>
        <span className="num text-[13px] text-fg">
          {value.toFixed(digits)}
          <span className="ml-1 text-[11px] text-muted">{unit}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="num w-7 text-[10px] text-faint">{min.toFixed(min % 1 === 0 ? 0 : digits)}</span>
        <input
          id={testId}
          data-testid={testId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={style}
          aria-valuetext={`${value.toFixed(digits)} ${unit}`}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="num w-7 text-right text-[10px] text-faint">{max.toFixed(max % 1 === 0 ? 0 : digits)}</span>
      </div>
    </div>
  );
}

export function Readout({
  label,
  hint,
  value,
  unit,
  color,
  align = "left",
}: {
  label: string;
  hint?: GlossaryKey;
  value: string;
  unit?: string;
  color?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="text-[11px] text-muted">{hint ? <Term k={hint}>{label}</Term> : label}</div>
      <div className="num text-[14px] leading-5 text-fg" style={{ color }}>
        {value}
        {unit ? <span className="ml-1 text-[11px] text-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

export function Tag({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-2 text-[11px] font-medium"
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}14` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

/** Jargon with a plain-language explanation on hover or keyboard focus. */
export function Term({ k, children }: { k: GlossaryKey; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [pos, setPos] = useState<CSSProperties | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 280;
    const left = Math.min(Math.max(r.left, 8), window.innerWidth - width - 8);
    // Fixed positioning keeps the tooltip out of the scrolling panels' clip rect.
    setPos(
      r.bottom + 130 > window.innerHeight
        ? { left, bottom: window.innerHeight - r.top + 6, width }
        : { left, top: r.bottom + 6, width },
    );
  }, []);
  const hide = useCallback(() => setPos(null), []);

  return (
    <span
      ref={ref}
      tabIndex={0}
      aria-describedby={pos ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
      className="cursor-help rounded-[2px] underline decoration-faint decoration-dotted underline-offset-[3px]"
    >
      {children}
      {pos ? (
        <span
          id={id}
          role="tooltip"
          style={pos}
          className="pointer-events-none fixed z-[60] rounded-md border border-line-strong bg-raised px-3 py-2 text-left font-sans text-[12px] font-normal normal-case leading-relaxed tracking-normal text-fg shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        >
          {GLOSSARY[k]}
        </span>
      ) : null}
    </span>
  );
}

export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  const widths = ["92%", "76%", "84%", "60%", "88%", "70%"];
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton h-3" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

export function Stat({
  label,
  hint,
  value,
  unit,
  color,
}: {
  label: string;
  hint?: GlossaryKey;
  value: string;
  unit?: string;
  color?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted">{hint ? <Term k={hint}>{label}</Term> : label}</div>
      <div className="num mt-0.5 truncate text-[14px] text-fg" style={{ color }}>
        {value}
        {unit ? <span className="ml-1 text-[11px] text-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

/** A short description shown when the wrapped element is hovered or reached by keyboard. */
export function Tip({
  text,
  children,
  className = "",
  focusable = false,
  label,
}: {
  text: string;
  children: ReactNode;
  className?: string;
  focusable?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [pos, setPos] = useState<CSSProperties | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 280;
    const left = Math.min(Math.max(r.left, 8), window.innerWidth - width - 8);
    setPos(
      r.bottom + 130 > window.innerHeight
        ? { left, bottom: window.innerHeight - r.top + 6, width }
        : { left, top: r.bottom + 6, width },
    );
  }, []);
  const hide = useCallback(() => setPos(null), []);

  return (
    <span
      ref={ref}
      tabIndex={focusable ? 0 : undefined}
      aria-label={label}
      aria-describedby={pos ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={(e) => {
        // A mouse click also focuses the element; only keyboard focus should open the description.
        if ((e.target as HTMLElement).matches(":focus-visible")) show();
      }}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
      className={className}
    >
      {children}
      {pos ? (
        <span
          id={id}
          role="tooltip"
          style={pos}
          className="pointer-events-none fixed z-[60] whitespace-normal rounded-md border border-line-strong bg-raised px-3 py-2 text-left font-sans text-[12px] font-normal normal-case leading-relaxed tracking-normal text-fg shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

/** A small question mark that explains the thing beside it. */
export function Help({ text }: { text: string }) {
  return (
    <Tip
      text={text}
      focusable
      label="What is this?"
      className="inline-flex h-[15px] w-[15px] shrink-0 cursor-help items-center justify-center rounded-full border border-line-strong font-sans text-[10px] font-medium leading-none tracking-normal text-muted hover:border-muted hover:text-fg"
    >
      ?
    </Tip>
  );
}

/** Open or closed state for a section, remembered in this browser. */
export function useFold(id: string, defaultOpen = true): [boolean, () => void] {
  const key = `ignis.fold.${id}`;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved !== null) setOpen(saved === "1");
    } catch {
      // Storage can be blocked; the section just starts in its default state.
    }
  }, [key]);
  const toggle = useCallback(() => {
    setOpen((was) => {
      try {
        window.localStorage.setItem(key, was ? "0" : "1");
      } catch {
        // Not remembered, still toggled.
      }
      return !was;
    });
  }, [key]);
  return [open, toggle];
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A titled group that drops down and folds away when its heading is clicked. */
export function Collapsible({
  id,
  title,
  help,
  right,
  defaultOpen = true,
  children,
  className = "",
  bodyClassName = "",
}: {
  id: string;
  title: string;
  help?: string;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const [open, toggle] = useFold(id, defaultOpen);
  const bodyId = useId();
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            data-testid={`fold-${id}`}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
            className="label -ml-1 flex items-center gap-1.5 rounded-[3px] px-1 py-0.5 text-left hover:text-fg"
          >
            <Chevron open={open} />
            {title}
          </button>
          {help ? <Help text={help} /> : null}
        </div>
        {right}
      </div>
      {open ? (
        <div id={bodyId} className={bodyClassName}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
