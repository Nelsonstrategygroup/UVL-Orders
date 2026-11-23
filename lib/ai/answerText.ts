// Showing an answer on screen. The model may mark key numbers **bold**; show
// them bold instead of with asterisks. Headings ("## Totals") show as a bold
// line. Pure, so it can be tested; drawn by components/ask/AskChat.

export type Piece = { text: string; bold: boolean };

/** One line of an answer, split into plain and bold pieces. */
export function answerLine(line: string): Piece[] {
  const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
  if (heading) return [{ text: heading[1].replace(/\*\*/g, ""), bold: true }];
  const pieces: Piece[] = [];
  const re = /\*\*([^*\n]+?)\*\*/g;
  let at = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) pieces.push({ text: line.slice(at, m.index), bold: false });
    pieces.push({ text: m[1], bold: true });
    at = m.index + m[0].length;
  }
  if (at < line.length) pieces.push({ text: line.slice(at), bold: false });
  // A lone ** left over (unmatched) would show as asterisks: drop it.
  return pieces.map((p) => (p.bold ? p : { ...p, text: p.text.replace(/\*\*/g, "") }));
}
