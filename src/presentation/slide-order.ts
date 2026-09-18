export function insertRoutingDemos<T extends { id: string }>(slides: readonly T[], demo: T, encore?: T): T[] {
  if (!slides.some(slide => slide.id === "authored-6")) throw new Error("The acknowledgments slide is missing.");
  if (!slides.some(slide => slide.id === "authored-10")) throw new Error("The explorer recovery slide is missing.");
  return slides.flatMap(slide => {
    if (slide.id === "authored-6") return [slide, demo];
    if (slide.id === "authored-10") return [slide, encore ?? { ...demo, id: `${demo.id}-explorers` }];
    return [slide];
  });
}
