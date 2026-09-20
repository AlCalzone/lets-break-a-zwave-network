import { createRoot } from "react-dom/client";
import type { Slide } from "./presentation/Deck";
import { PresentationApp } from "./PresentationApp";
import { ConnectionsLink } from "./presentation/ConnectionsContext";
import authoredSlides from "./slides/authored.json";
import "./styles/fonts.css";
import "./styles/industry.css";
import "./styles/slides.css";
import "./styles/presentation.css";

const slides: Slide[] = [...authoredSlides.map((slide) => ({
  id: `authored-${slide.number}`,
  title: slide.title,
  notes: slide.notes,
  content: <>
    <div className="authored-slide" dangerouslySetInnerHTML={{ __html: slide.html }} />
    {slide.number === 1 && <ConnectionsLink placement="title" />}
  </>,
}))];

createRoot(document.getElementById("root")!).render(<PresentationApp slides={slides} />);
