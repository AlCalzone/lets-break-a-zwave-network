# Let's break a Z-Wave network

A browser presentation built from the Claude Design export. The 14 authored slides are preserved. Live routing demonstrations follow "Acknowledgments" and "Retry, reroute, explore", appearing as slides 7 and 12. A live beaming demonstration follows slide 15. An RCP control demonstration follows slide 17. Two three-RCP network-jamming demonstrations are followed by a two-RCP return-route relay demonstration. Together they complete the 21-slide deck.

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
3. Connect **RCP · rcp-1**, **rcp-2**, and **rcp-3** to the three 500000-baud radio co-processors used by the live radio demonstrations. Use **Add RCP** for any additional radio co-processors.
4. Select **Start presentation**. Use **Connections** in the slide navigation to reopen setup.

Every interactive slide also has a top-right **Connections** link with Ready or Not ready status. `src/zwave/setup-status.ts` defines setup readiness centrally: a ready main controller, a capturing Zniffer, and the three required RCP connections with confirmed radio settings. Individual demonstrations also check their required nodes and command classes.

Connecting configures EU Long Range on each radio. The Zniffer uses Classic + LR A. Optional RCPs use the same channel configuration. Setup shows the confirmed settings. Unsupported regions, unsupported channel configurations, or mismatched readback prevent the connection from becoming ready. The main Driver may soft-reset its controller to apply the region.

**Re-interview all** on the main Driver row requests fresh interviews for every device, including Long Range nodes. Running interviews continue unchanged. The controller itself is excluded. Per-node readiness and failures appear in setup. Sleeping devices may need waking to finish.

Each Connect button opens Chrome's serial-device picker. A port can have only one role at a time. Close other applications holding the same serial ports before connecting. The browser saves each granted port selection and restores it on the next page load when Chrome still grants access to the same port. `rcp-1`, `rcp-2`, and `rcp-3` use two connection attempts because their first RCP handshake can fail. The main Driver, Zniffer, and RCP instances stay connected across slide changes. Reloading the page releases the browser instances. Connection setup stays closed until opened explicitly. The top-right **X** closes setup at any time. Live controls remain disabled until the required connections are ready.

For securely included devices, expand **Network security keys** before connecting. Enter the network's existing 32-character hexadecimal keys and select **Save keys**. Classic and Long Range keys have separate fields. The main Driver and Zniffer receive the same configured keys. Keys are saved in local storage for this browser profile and origin. Reloading restores them before connecting. Disconnect both devices before replacing keys. **Clear saved keys** removes them. Clearing browser site data also removes them.

Keep network keys out of Git. Local setup notes can be stored in the ignored `.local/` directory.

Local builds can include fallback keys through `VITE_ZWAVE_SECURITY_KEYS` in the ignored `.env.local` file. Its value is a JSON object with fields `S0_Legacy`, `S2_Unauthenticated`, `S2_Authenticated`, `S2_AccessControl`, `LR_Authenticated`, and `LR_AccessControl`. Each value is a 32-character hexadecimal key. Rebuild after changing this file. Saved browser keys override the fallback per field. Missing keys use the fallback, including in a new browser profile or after clearing site data. With fallback keys configured, **Reset to defaults** removes saved overrides and immediately reapplies the fallback. Invalid saved keys still produce a setup error.

Fallback values are embedded in the generated browser bundle. Keep that build local and do not publish it or its keys.

The Driver's cache is isolated from RCP caches in browser storage. Keep the same browser profile and localhost origin for rehearsals. Z-Wave device access is browser-side; the Node service owns only the tinySA terminal.

## Live beaming demonstration

The slide after authored slide 13 sends raw beam frames from `rcp-1` toward nonexistent nodes. Classic beams target node 004. Fragmented Long Range beams target LR node 257. **Start beaming** runs one continuous beam for up to 65.535 seconds. **Stop beaming** aborts the active transmission. The presets send a 275 ms short beam, a 1100 ms long beam, or 16 fragmented beam frames of 112 ms every 200 ms on the configured Long Range channel. The right side embeds the live tinySA waterfall.

## Live routing demonstration

Slide 7 contains the real node 002 plug controls and a Zniffer lane view for nodes 001, 002, and 003. Choose Direct or Via 003, then select 9.6k, 40k, or 100k. On and Off send only `node.commandClasses["Binary Switch"].set(...)`. There is no follow-up Get. An acknowledged command updates the plug toggle to the requested state. Unsupervised commands show "acknowledged". Successful supervision shows "confirmed". Failed commands leave the toggle unchanged. Device reports still update the displayed state. PING uses `node.ping()`.

Each demonstration calls `controller.setPriorityRoute(2, [], speed)` for direct communication or `controller.setPriorityRoute(2, [3], speed)` for routing through the dimmer. The route is removed with `controller.removePriorityRoute(2)` after the command. Cleanup also runs on failure. A failed cleanup blocks further demonstrations until **Clear priority route** succeeds.

Z-Wave JS priority routes select the first transmission attempt. The controller may fall back after a failed attempt. The lane view displays the actual over-the-air hops and speeds captured by the Zniffer.

Capture is filtered to the main network's Home ID and nodes 001, 002, 003, and 256. Routing slides display lanes in order 001, 003, 002 and hide node 256. The repeater remains visible because the controller can fall back to a routed transmission. Switching modes preserves capture history. Starting an action clears the displayed capture history. Capture continues afterward to include delayed acknowledgments. Up to 512 frames are retained. Filtered, invalid, unsupported, and evicted frames are counted in setup. Driver command results never generate lane-view frames.

## Network-jamming demonstration

The slide after the RCP control demonstration uses `rcp-1`, `rcp-2`, and `rcp-3`. Each RCP repeatedly sends a 64-byte direct frame at 9.6 kbit/s toward nonexistent node 007. The RCPs use source node IDs 004, 005, and 006. Their 90 ms cycles begin 30 ms apart. Each frame occupies about 53.3 ms on air, so at least one RCP transmits continuously. CCA is disabled for these frames. Leaving the slide stops the loop.

The two jamming slides use the same three-column layout: controls, compact Zniffer frame log, and live tinySA waterfall. The first floods node 007 with 9.6 kbit/s frames. The next sends 1100 ms Classic 40 kbit/s beams toward node 007. The beam RCPs transmit one at a time in round-robin order with no intentional gap. A busy channel retries the same RCP after 50 ms. Leaving either slide stops its jammer and aborts an active beam.

The plug controls use the main Driver with an empty priority route at 100 kbit/s. Their status shows whether On, Off, or Ping succeeds during the jamming demonstrations. Jammer frames are excluded from the lane view as unrelated nodes. The filtered-frame counter shows that this traffic is still being received by the Zniffer.

The Long Range counter waits for Central Scene commands from node 256. It ignores key release and held-down refresh events. It also ignores a command with the previous Central Scene sequence number. The slide includes node 256 in its Zniffer lanes so a received LR press is visible before flooding and can be compared with presses attempted during the 9.6 kbit/s flood.

## Run

Use Node.js 22.12+ and desktop Chrome or Edge.

```sh
npm install
SDRTOP_BIN=/absolute/path/to/sdrtop npm run dev
```

Open the localhost URL printed by the server. Configure the receiver once from the waterfall demo. Supply the tinySA port, center frequency, and span. A successful launch saves those settings. Future service starts launch sdrtop and begin reception automatically in the background.

The generated `sdrtop` configuration uses 64 sweep points and fixes the tinySA resolution bandwidth at 300 kHz. This favors short waterfall sweeps over frequency resolution. It retains 512 waterfall history rows. `sdrtop` does not expose a VBW setting, so the tinySA firmware controls VBW.

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

All live Zniffer views must filter captured frames by the main controller's Home ID unless explicitly requested otherwise. Read the Home ID from the connected main Driver. Apply the filter through `createCaptureHistory` before retaining frames or establishing the trace's time origin. Matching node IDs alone do not identify the network.

Normal explorer frames display as broadcasts from the observed transmitting node. Each dashed arrow points right and ends 80% of the way to the next lane with a spreading-wave marker. The last lane uses the same spacing into empty space. These markers do not imply reception by a particular node. One-line chips show recorded repeaters as `Explore [ 3 ]` and final repeaters from the result payload as `Result [ 3 ]`. An empty list appears as `Explore [ ]`. Multiple repeaters are comma-separated without leading zeros. Search results use directed arrows for the observed return hop. Frame logs use the same labels and identify explorer delivery as **Broadcast**. Home ID and node filtering still apply. Inclusion explorers and beams remain unsupported.

All live transmissions default to `maxSendAttempts: 1` unless explicitly requested otherwise. The main Driver sets `attempts.sendData: 1`, which supplies the default `maxSendAttempts` for commands, including Binary Switch Set and PING. It also sets `attempts.sendDataJammed: 1` to disable the separate jammed-controller resend loop. Controller-level radio retries and route fallback remain enabled. A command may explicitly override `maxSendAttempts` for a demonstration that needs host retries.

Each Zniffer view has a **Clear** button. It removes captured frames without changing device state or stopping capture. Trace times display whole milliseconds. Raw timestamps retain their precision. Live captures start at 0 ms on the first accepted frame. Demonstration capture begins after priority-route setup.

Text frame labels use Barlow Condensed in lanes and logs. Binary payload bytes retain IBM Plex Mono. Lane chips measure their rendered text and add only padding and space for the speed swatch. Font loading updates their widths.

Opening connection setup pauses frame forwarding to all views. The Zniffer keeps running. Closing setup resumes forwarding new frames. Frames received during setup are not replayed.

`src/components/terminal/` and `src/terminal/` contain the live terminal view and its client connection. `server/` owns the PTY process.

`src/zwave/` owns the browser hardware connections, real capture mapping, and priority-route lifecycle. `src/slides/RealRoutingSlide.tsx` composes the live controls and lane view.

`src/slides/authored.json` stores the original slide bodies and notes. `src/styles/` retains the exported design tokens and layout. `design/interaction-references.json` preserves reference sheets 15-19 outside presentation navigation.

To import a revised export, extract its archive and run:

```sh
node scripts/import-design.mjs /path/to/extracted-export
```

The importer expects the current 19-slide export. It imports the first 14 slides as presentation content. Review the imported result before presenting.
