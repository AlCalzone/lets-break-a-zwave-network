export type DemoSpeed = "9.6k" | "40k" | "100k";
export type PlugAction = "on" | "off" | "ping";

export interface RouteTransport {
  setRoute(repeaters: number[] | undefined, speed?: DemoSpeed): Promise<boolean>;
  send(action: PlugAction): Promise<string>;
}

export class PriorityRouteDemo {
  busy = false;
  cleanupRequired = false;

  async run(transport: RouteTransport, action: PlugAction, routed: boolean, speed: DemoSpeed, beforeSend?: () => void) {
    if (this.busy) throw new Error("Wait for the current demonstration to finish.");
    if (this.cleanupRequired) throw new Error("Clear the previous priority route before another demonstration.");
    this.busy = true;
    let failure: unknown;
    let detail = "";
    try {
      this.cleanupRequired = true;
      if (!await transport.setRoute(routed ? [3] : [], speed)) {
        throw new Error("The controller did not accept the priority route. No command was sent.");
      }
      beforeSend?.();
      detail = await transport.send(action);
    } catch (error) {
      failure = error;
    } finally {
      try {
        if (!await transport.setRoute(undefined)) throw new Error("The controller did not confirm priority route removal.");
        this.cleanupRequired = false;
      } catch (error) {
        failure = new Error(`${failure ? `${errorMessage(failure)} ` : ""}Priority route cleanup failed: ${errorMessage(error)}`);
      }
      this.busy = false;
    }
    if (failure) throw failure;
    return detail;
  }

  async clear(transport: Pick<RouteTransport, "setRoute">) {
    if (this.busy) throw new Error("Wait for the current demonstration to finish.");
    this.busy = true;
    this.cleanupRequired = true;
    try {
      if (!await transport.setRoute(undefined)) throw new Error("The controller did not confirm priority route removal.");
      this.cleanupRequired = false;
    } finally {
      this.busy = false;
    }
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
