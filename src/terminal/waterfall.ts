export interface TerminalRegion {
  top: number;
  left: number;
  rows: number;
  cols: number;
}

export function findWaterfallRegion(lines: string[]): TerminalRegion | null {
  for (let top = 0; top < lines.length; top++) {
    const title = lines[top];
    const heading = title.indexOf('╴WATERFALL╶');
    if (heading < 0) continue;
    const left = title.search(/[┏┌╭]/);
    const right = title.search(/[┓┐╮]/);
    if (left < 0 || left >= heading || right <= heading) continue;
    for (let bottom = top + 1; bottom < lines.length; bottom++) {
      const edge = lines[bottom].slice(left, right + 1);
      if (bottom > top + 1 && edge.length === right - left + 1 && /^[┗└╰][─━]+[┛┘╯]$/.test(edge)) {
        return { top, left, rows: bottom - top + 1, cols: right - left + 1 };
      }
      if (!/[│┃]/.test(lines[bottom][left] ?? '') || !/[│┃]/.test(lines[bottom][right] ?? '')) break;
    }
  }
  return null;
}
