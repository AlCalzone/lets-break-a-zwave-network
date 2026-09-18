import type { RxState } from '../src/terminal/protocol.ts';

export interface ScreenState {
  menu: boolean;
  prompt: 'frequency' | 'span' | null;
  focused: boolean;
  waterfall: boolean;
  device: string | null;
  rx: RxState;
  frequencyMHz: number | null;
  spanMHz: number | null;
  errors: string[];
  logs: string[];
}

export function parseScreen(text: string): ScreenState {
  const lines = text.split('\n');
  const menu = /Enter\s+open/.test(text) && /Tab\s+section/.test(text) && /sdrtop/i.test(text);
  const header = lines.slice(0, 5).join('\n');
  const deviceLine = lines.slice(0, 5).find((line) => /\btinySA\b/i.test(line));
  const observer = /\bOBSERVER\b/.test(header);
  const rx: RxState = !menu && deviceLine && !observer
    ? /\bRX\b/.test(deviceLine) ? 'receiving' : /\bIDLE\b/.test(deviceLine) ? 'stopped' : 'unknown'
    : 'unknown';
  const tuning = header.match(/([\d ][\d .]*?)\s+MHz\s+SPAN\s+([\d.]+)\s+MHz/);
  const logs = lines.filter((line) => /[·●▲]\s+\d{2}:\d{2}:\d{2}\s/.test(line));
  return {
    menu,
    prompt: /Frequency \(MHz\):\s*\[/.test(text) ? 'frequency'
      : /Span \([^)\n]*MHz\):\s*\[/.test(text) ? 'span' : null,
    focused: /\bFOCUS(?:ED)?\b/i.test(text) || (!menu && !/\bRadio\b/i.test(header) && /\bWaterfall\b/i.test(text)),
    waterfall: !menu && /╴WATERFALL╶/i.test(text) && /\bRadio\b/i.test(header),
    device: deviceLine && !observer ? deviceLine.match(/tinySA[^│┃]*?(?=\s+[○●◉◌◍◦•∙◈]|\s+(?:RX|IDLE)\b|$)/i)?.[0].trim() ?? 'tinySA' : null,
    rx,
    frequencyMHz: tuning ? Number(tuning[1].replaceAll(' ', '')) : null,
    spanMHz: tuning ? Number(tuning[2]) : null,
    errors: logs.filter((line) => /\berror\b|failed|unexpectedly|disconnected|no device|invalid frequency|invalid span/i.test(line)),
    logs,
  };
}
