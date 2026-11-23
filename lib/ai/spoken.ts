// Turning an answer into something that sounds right read aloud. Pure, so it
// can be tested; used by the browser's speech in components/ask.

/** Drop the formatting marks a speech voice would read out ("asterisk", "pipe"). */
export function forSpeech(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .map((line) => {
      if (/^\s*\|?\s*:?-{2,}/.test(line)) return ""; // table divider row
      let l = line;
      if (l.includes("|")) {
        l = l
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean)
          .join(", ");
      }
      return l
        .replace(/`([^`]*)`/g, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*[-*•]\s+/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/(^|\s)\*([^*]+)\*/g, "$1$2")
        .replace(/[ \t]+/g, " ")
        .trim();
    })
    .filter(Boolean)
    .join("\n");
}
