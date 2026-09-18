import type { ReactNode } from "react";
import { ConnectionsLink } from "./ConnectionsContext";

export function Corners() {
  return <><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>;
}

export function SlideFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="slide content demo-slide">
      <div className="board" aria-hidden="true"><Corners /></div>
      <ConnectionsLink />
      <h2 className="slide-title">{title}</h2>
      {children}
      <div className="page-foot" aria-hidden="true" />
    </section>
  );
}
