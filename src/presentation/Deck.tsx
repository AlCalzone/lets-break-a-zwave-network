import { useEffect, useRef, useState, type ReactNode } from "react";
import { elementOwnsArrowKeys, navigationTarget } from "./navigation";

export interface Slide {
  id: string;
  title: string;
  notes?: string;
  content: ReactNode;
}

function initialSlide(count: number) {
  const requested = Number(location.hash.replace("#slide-", ""));
  return Number.isInteger(requested) && requested > 0
    ? Math.min(requested - 1, count - 1)
    : 0;
}

export function Deck({ slides, onConfigure }: { slides: Slide[]; onConfigure?: () => void }) {
  const [index, setIndex] = useState(() => initialSlide(slides.length));
  const [scale, setScale] = useState(() => Math.min(innerWidth / 1920, innerHeight / 1080));
  const [notesOpen, setNotesOpen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const canvas = useRef<HTMLDivElement>(null);
  const title = slides[index].title;

  useEffect(() => {
    const resize = () => setScale(Math.min(innerWidth / 1920, innerHeight / 1080));
    const hashChange = () => setIndex(initialSlide(slides.length));
    window.addEventListener("resize", resize);
    window.addEventListener("hashchange", hashChange);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("hashchange", hashChange);
    };
  }, [slides.length]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (notesOpen) return;
      const target = event.composedPath()[0];
      if (target instanceof Element && elementOwnsArrowKeys(target)) return;
      const next = navigationTarget(event.key, index, slides.length);
      if (next === undefined) return;
      event.preventDefault();
      setIndex(next);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [index, slides.length, notesOpen]);

  useEffect(() => {
    history.replaceState(null, "", `#slide-${index + 1}`);
    document.title = `${index + 1}. ${title} — Z-Wave`;
    if (document.activeElement instanceof HTMLElement &&
        document.activeElement.closest(".slide-slot[inert]")) {
      canvas.current?.focus({ preventScroll: true });
    }
  }, [index, title]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError("");
    } catch (error) {
      setFullscreenError(error instanceof Error ? error.message : "Fullscreen is unavailable.");
    }
  }

  return (
    <main className="presentation">
      <div
        ref={canvas}
        className="deck-canvas"
        tabIndex={-1}
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        aria-label="Z-Wave presentation"
      >
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            className="slide-slot"
            data-deck-active={i === index ? "" : undefined}
            aria-hidden={i !== index}
            inert={i !== index}
            style={{ counterReset: `page ${i}` }}
          >
            {slide.content}
          </div>
        ))}
      </div>
      <nav className="deck-nav" aria-label="Slide navigation">
        <button onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} aria-label="Previous slide">←</button>
        <label className="slide-select">
          <span className="sr-only">Go to slide</span>
          <select value={index} onChange={(event) => setIndex(Number(event.target.value))}>
            {slides.map((slide, i) => <option key={slide.id} value={i}>{String(i + 1).padStart(2, "0")} / {slides.length} · {slide.title}</option>)}
          </select>
        </label>
        <button onClick={() => setIndex((value) => Math.min(slides.length - 1, value + 1))} disabled={index === slides.length - 1} aria-label="Next slide">→</button>
        <span className="nav-divider" />
        <button onClick={() => setNotesOpen((open) => !open)} aria-expanded={notesOpen}>Notes</button>
        <button onClick={toggleFullscreen}>Fullscreen</button>
        {onConfigure && <button onClick={onConfigure}>Connections</button>}
      </nav>
      {fullscreenError && <p className="deck-error" role="alert">{fullscreenError}</p>}
      {notesOpen && (
        <aside className="speaker-notes" aria-label="Speaker notes" data-own-arrow-keys>
          <div><strong>{index + 1}. {title}</strong><button onClick={() => setNotesOpen(false)}>Close</button></div>
          <p>{slides[index].notes || "Interactive demonstration. Node and frame data are simulated."}</p>
        </aside>
      )}
    </main>
  );
}
