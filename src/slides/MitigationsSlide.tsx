import { SlideFrame } from "../presentation/SlideFrame";

const mitigations = [
  { title: "Encrypting the application layer", detail: "Prevent others from eavesdropping and controlling devices" },
  { title: "Supervised requests", detail: "Get notified when the command was received and executed" },
  { title: "Encrypting the network layer", detail: "Prevent others from manipulating routes and neighbor information" },
];

export function MitigationsSlide() {
  return (
    <SlideFrame title="What can be done about it?" showConnections={false}>
      <div className="mitigations-props rise">
        {mitigations.map(({ title, detail }) => (
          <div key={title}>
            <h3>{title}</h3>
            <p>{detail}</p>
          </div>
        ))}
      </div>
    </SlideFrame>
  );
}
