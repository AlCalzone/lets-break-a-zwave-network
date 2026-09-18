import { createRoot } from "react-dom/client";
import type { Slide } from "./presentation/Deck";
import { PresentationApp } from "./PresentationApp";
import { ConnectionsLink } from "./presentation/ConnectionsContext";
import authoredSlides from "./slides/authored.json";
import { DemoProvider } from "./demo/store";
import { FrameDemo, LaneDemo, WaterfallDemo } from "./slides/DemoSlides";
import { ReceiverPanel } from "./slides/ReceiverPanel";
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
})), {
  id: "demo-lanes",
  title: "Follow the conversation",
  notes: "Mock nodes and frames. Use Basic Set or Ping to follow a routed exchange. Change the delivery scenario to show retries or a missing acknowledgment.",
  content: <LaneDemo />,
}, {
  id: "demo-frames",
  title: "Every frame tells a story",
  notes: "The same simulated frames can be shown as a full log, a compact log, or a hop list. Node actions and state persist between demo slides.",
  content: <FrameDemo />,
}, {
  id: "demo-waterfall",
  title: "See the network on air",
  notes: "Node controls and frames remain simulated. Configure the connected tinySA to show real RF activity through sdrtop. Mock actions do not transmit. Start RX and Stop RX control the receiver.",
  content: <WaterfallDemo terminal={<ReceiverPanel />} />,
}];

createRoot(document.getElementById("root")!).render(<DemoProvider><PresentationApp slides={slides} /></DemoProvider>);
