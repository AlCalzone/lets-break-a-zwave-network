import { useLayoutEffect, useRef } from "react";

export function followNewestFrame(element: HTMLElement) {
  const slide = element.closest(".slide-slot");
  const scrollToNewest = () => {
    if (!slide || slide.hasAttribute("data-deck-active")) {
      element.scrollTop = element.scrollHeight;
    }
  };
  scrollToNewest();
  const visibility = new MutationObserver(scrollToNewest);
  if (slide) visibility.observe(slide, { attributes: true, attributeFilter: ["data-deck-active"] });
  const size = new ResizeObserver(scrollToNewest);
  size.observe(element);
  return () => {
    visibility.disconnect();
    size.disconnect();
  };
}

export function useFrameScroll(latestId: string | undefined, variant?: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) return followNewestFrame(ref.current);
  }, [latestId, variant]);
  return ref;
}
