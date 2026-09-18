export function navigationTarget(
  key: string,
  current: number,
  count: number,
): number | undefined {
  if (key === "ArrowRight" || key === "PageDown") return Math.min(count - 1, current + 1);
  if (key === "ArrowLeft" || key === "PageUp") return Math.max(0, current - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}

export function elementOwnsArrowKeys(element: Element | null): boolean {
  return !!element?.closest(
    'dialog[open], input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="tablist"], [role="listbox"], [role="radiogroup"], [data-own-arrow-keys]',
  );
}
