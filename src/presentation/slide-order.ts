export function insertRoutingDemos<T extends { id: string }>(
  slides: readonly T[],
  demo: T,
  encore?: T,
  beaming?: T,
  rcpControl?: T,
  jamming?: T,
  beamJamming?: T,
  returnRouteRelay?: T,
): T[] {
  if (!slides.some(slide => slide.id === "authored-6")) throw new Error("The acknowledgments slide is missing.");
  if (!slides.some(slide => slide.id === "authored-10")) throw new Error("The explorer recovery slide is missing.");
  if (beaming && !slides.some(slide => slide.id === "authored-13")) throw new Error("The beaming slide is missing.");
  if (rcpControl && !slides.some(slide => slide.id === "authored-14")) throw new Error("The live setup slide is missing.");
  if (jamming && !rcpControl) throw new Error("The RCP control slide is required before the jamming slide.");
  if (beamJamming && !jamming) throw new Error("The frame-jamming slide is required before the beam-jamming slide.");
  if (returnRouteRelay && !beamJamming) throw new Error("The beam-jamming slide is required before the return-route relay slide.");
  return slides.flatMap(slide => {
    if (slide.id === "authored-6") return [slide, demo];
    if (slide.id === "authored-10") return [slide, encore ?? { ...demo, id: `${demo.id}-explorers` }];
    if (slide.id === "authored-13" && beaming) return [slide, beaming];
    if (slide.id === "authored-14" && rcpControl) {
      return [slide, rcpControl, ...(jamming ? [jamming] : []), ...(beamJamming ? [beamJamming] : []),
        ...(returnRouteRelay ? [returnRouteRelay] : [])];
    }
    return [slide];
  });
}
