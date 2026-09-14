import { useEffect, useRef, type ReactNode } from "react";
import { KitchenSketch } from './JournalArt';

export type IconName = "sun" | "pantry" | "book" | "plus" | "moon" | "bowl" | "arrow" | "close" | "grid" | "history";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    moon: <path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z" />,
    pantry: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M5 10h14M9 6v1m0 7v3" /></>,
    book: <path d="M4 5a2 2 0 0 1 2-2h14v17H6a2 2 0 0 0-2 2V5Zm0 13a2 2 0 0 1 2-2h14M8 7h8m-8 4h5" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    history: <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2" />,
    bowl: <><path d="M3 11h18c0 6-3 9-9 9s-9-3-9-9Z" /><path d="M9 7c-2-2 2-2 0-4m6 4c-2-2 2-2 0-4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><KitchenSketch /><h3>{title}</h3><p>{children}</p></div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Dialog({ title, onClose, children, busy }: { title: string; onClose: () => void; children: ReactNode; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" aria-label="关闭弹窗" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}
