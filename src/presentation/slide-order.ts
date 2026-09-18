export function insertRoutingDemo<T extends { id: string }>(slides: readonly T[], demo: T): T[] {
  const acknowledgments = slides.findIndex(slide => slide.id === "authored-6");
  if (acknowledgments < 0) throw new Error("The acknowledgments slide is missing.");
  return [...slides.slice(0, acknowledgments + 1), demo, ...slides.slice(acknowledgments + 1)];
}
