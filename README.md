# Let's break a Z-Wave network

A browser presentation built from the Claude Design export. The 14 authored slides are preserved. A live routing demonstration is inserted after the authored slide 6, "Acknowledgments". Three mock demo slides follow the authored deck.

The routing demonstration uses real Z-Wave devices and a separate Zniffer capture adapter through Web Serial. The three appended demos retain their simulated nodes and frames. The waterfall connects to a real local `sdrtop` process and tinySA.

## Real Z-Wave network

The presentation hardware is already included in one real network:

| Node ID | Device | Commands and events | Demonstrations |
| --- | --- | --- | --- |
| 1 | Controller | Network controller | Communicates with the devices below |
| 2 | Plug | Binary Switch: On / Off | Direct communication and routing |
| 3 | Dimmer | Multilevel Switch: `0` / `99` | Direct communication and routing |
| 256 | Wall Controller, Long Range | Sends Central Scene notifications for scene `1`. Responds to Indicator CC V1: `0` = off, `99` = on. | Long Range, direct communication only |

Nodes 2 and 3 can participate in routed demonstrations. Node 256 must communicate directly with the controller and must never be used as a routing hop.

This inventory describes the physical network. The current mock fixtures use a separate demonstration topology.

## Connect before presenting

Open the presentation in desktop Chrome or Edge on localhost. Open connection setup through the link icon beneath the title-slide avatar or in the top-right corner of an interactive slide. The icon is red until setup is ready, then light gray.

1. Connect **Main controller · Driver** to the Serial API controller for node 001. Wait for the interviews of nodes 002 and 003 to complete.
2. Connect **Zniffer · live radio capture** to a separate adapter running Zniffer firmware. Capture starts when initialization succeeds.
3. Use **Add RCP** for each additional radio co-processor needed for later experiments. These use dedicated Z-Wave JS `RCPHost` instances. They are optional for the first live demonstration.
4. Select **Start presentation**. Use **Connections** in the slide navigation to reopen setup.

Every interactive slide also has a top-right **Connections** link with Ready or Not ready status. `src/zwave/setup-status.ts` defines setup readiness centrally: a ready main controller and a capturing Zniffer with confirmed radio settings. RCPs are currently optional. Individual demonstrations also check their required nodes and command classes.

Connecting configures EU Long Range on each radio. The Zniffer uses Classic + LR A. Optional RCPs use the same channel configuration. Setup shows the confirmed settings. Unsupported regions, unsupported channel configurations, or mismatched readback prevent the connection from becoming ready. The main Driver may soft-reset its controller to apply the region.

**Re-interview all** on the main Driver row requests fresh interviews for every device, including Long Range nodes. Running interviews continue unchanged. The controller itself is excluded. Per-node readiness and failures appear in setup. Sleeping devices may need waking to finish.

Each Connect button opens Chrome's serial-device picker. A port can have only one role at a time. Close other applications holding the same serial ports before connecting. The main Driver, Zniffer, and RCP instances stay connected across slide changes. Reloading the page releases the browser instances. Connection setup stays closed until opened explicitly. The top-right **X** closes setup at any time. Live controls remain disabled until the required connections are ready.

For securely included devices, expand **Network security keys** before connecting. Enter the network's existing 32-character hexadecimal keys and select **Save keys**. Classic and Long Range keys have separate fields. The main Driver and Zniffer receive the same configured keys. Keys are saved in local storage for this browser profile and origin. Reloading restores them before connecting. Disconnect both devices before replacing keys. **Clear saved keys** removes them. Clearing browser site data also removes them.

Keep network keys out of Git. Local setup notes can be stored in the ignored `.local/` directory.

The Driver's cache is isolated from RCP caches in browser storage. Keep the same browser profile and localhost origin for rehearsals. Z-Wave device access is browser-side; the Node service owns only the tinySA terminal.

## Live routing demonstration

Slide 7 contains the real node 002 plug controls and a Zniffer lane view for nodes 001, 002, and 003. Choose Direct or Via 003, then select 9.6k, 40k, or 100k. On and Off send only `node.commandClasses["Binary Switch"].set(...)`. There is no follow-up Get. An acknowledged command updates the plug toggle to the requested state. Unsupervised commands show "acknowledged". Successful supervision shows "confirmed". Failed commands leave the toggle unchanged. Device reports still update the displayed state. PING uses `node.ping()`.

Each demonstration calls `controller.setPriorityRoute(2, [], speed)` for direct communication or `controller.setPriorityRoute(2, [3], speed)` for routing through the dimmer. The route is removed with `controller.removePriorityRoute(2)` after the command. Cleanup also runs on failure. A failed cleanup blocks further demonstrations until **Clear priority route** succeeds.

Z-Wave JS priority routes select the first transmission attempt. The controller may fall back after a failed attempt. The lane view displays the actual over-the-air hops and speeds captured by the Zniffer.

Capture is filtered to the main network's Home ID and nodes 001, 002, and 003. Direct mode displays lanes 001 and 002. Via 003 displays lanes in order 001, 003, 002. Switching modes preserves capture history. Starting an action clears the displayed capture history. Capture continues afterward to include delayed acknowledgments. Up to 512 frames are retained. Filtered, invalid, unsupported, and evicted frames are counted in setup. Driver command results never generate lane-view frames.

## Run

Use Node.js 22.12+ and desktop Chrome or Edge.

```sh
npm install
SDRTOP_BIN=/absolute/path/to/sdrtop npm run dev
```

Open the localhost URL printed by the server. Configure the receiver once from the waterfall demo. Supply the tinySA port, center frequency, and span. A successful launch saves those settings. Future service starts launch sdrtop and begin reception automatically in the background.

```sh
npm run build
SDRTOP_BIN=/absolute/path/to/sdrtop npm start
```

Fonts and artwork are bundled locally. The presentation needs no internet connection after installation.

## Present

Use Left/Right to navigate. Page Up/Page Down and Home/End also work. Inputs retain their editing keys. Space and Enter activate focused buttons.

Move the mouse to the bottom center to reveal slide selection, speaker notes, and fullscreen controls. Speaker notes appear on the presentation screen.

The three appended demo slides share one mock session. Change the scenario to show successful delivery, a retry, or missing acknowledgments. Reset restores the baseline. Navigation preserves both live connections and the mock session.

The sdrtop terminal accepts input through its dedicated controls. Direct typing into the terminal is disabled. A missing receiver or executable produces a visible setup error.

The final slide shows only the live waterfall frame. Its terminal colors and scale labels are preserved. **Configure** sits beside the receiver status inside the terminal header. It opens the receiver settings and process controls.

## Receiver setup

On the final demo slide, select **Configure**. Use the stable `/dev/serial/by-id/...` path when available. Enter center frequency and frequency span in MHz. Select **Auto / Ultra** for a tinySA Ultra. Select the required input for a tinySA Basic.

**Launch sdrtop** opens the process with RX stopped. **Start RX** begins reception. **Stop RX** stops reception but keeps the process open. **Quit process** releases the receiver.

Automatic startup runs once per local service start. Every receiver slide shares that process. Navigation and browser refresh leave reception unchanged. Explicit Stop RX and Quit stay stopped until you restart them or restart the local service. Startup failures appear on the slide and in receiver setup. Failed startup is not retried automatically.

The service saves receiver settings in `.local/sdrtop/setup.json`. Successful center/span changes update those settings. Remove that file to disable automatic startup. The service uses `.local/sdrtop/config.toml` for sdrtop. It leaves your normal sdrtop config unchanged. `SDRTOP_STATE_DIR` changes the directory for both files. `SDRTOP_BIN` chooses the executable at service startup. `PORT` changes the localhost port from 5173.

Controls follow sdrtop's existing terminal interface. An unrecognized screen or failed command disables further tuning until the process is relaunched. The displayed header may round the hardware's frequency and span.

Browser refresh reconnects to the same local process. Closing a browser tab does not stop reception. Use **Stop RX** or stop the local service when finished.

The integration has been exercised with a tinySA Ultra ZS405 and sdrtop `0.5.1 (82bca66)`. The receive-only rehearsal used 868.95 MHz center and a 1.9 MHz span. It covered tuning changes, repeated Start/Stop actions, slide navigation, and browser reconnection. Different sdrtop versions may change the terminal text used for state detection.

## Components

Keep presentation copy limited to the topic, controls, and action feedback. Put connection guidance and implementation details in setup or speaker notes. Label capture panels "Zniffer". Keep segmented controls content-sized and left-aligned.

`src/components/controls/` contains buttons, segmented controls, outcome indicators, and node cards.

`src/components/zniffer/` contains lane and frame views. Full logs, compact logs, and hop lists consume the same frame model. Data frames show uppercase hexadecimal payload bytes, such as `25 01 FF` for Switch Binary Set On. Longer payloads shrink to 18px before whole-byte truncation with `...`. Tooltips and accessible labels retain the full hexadecimal payload. ACK and routed error frames keep their labels. Every view scrolls through all retained frames and follows the newest frame on updates or slide entry. The shared mock history retains 64 frames to bound memory during a presentation.

Each Zniffer view has a **Clear** button. It removes captured frames without changing device state or stopping capture. Trace times display whole milliseconds. Raw timestamps retain their precision. Live captures start at 0 ms on the first accepted frame. Demonstration capture begins after priority-route setup.

Opening connection setup pauses frame forwarding to all views. The Zniffer keeps running. Closing setup resumes forwarding new frames. Frames received during setup are not replayed.

`src/components/terminal/` and `src/terminal/` contain the live terminal view and its client connection. `server/` owns the PTY process.

`src/zwave/` owns the browser hardware connections, real capture mapping, and priority-route lifecycle. `src/slides/RealRoutingSlide.tsx` composes the live controls and lane view.

`src/slides/authored.json` stores the original slide bodies and notes. `src/styles/` retains the exported design tokens and layout. `design/interaction-references.json` preserves reference sheets 15-19 outside presentation navigation.

To import a revised export, extract its archive and run:

```sh
node scripts/import-design.mjs /path/to/extracted-export
```

The importer expects the current 19-slide export. It imports the first 14 slides as presentation content. Review the imported result before presenting.
