import { interpolate, useCurrentFrame } from "remotion";
export const WordHighlight = ({ words }: { words: string[] }) => {
  const frame = useCurrentFrame();
  const active = Math.floor(interpolate(frame, [0, words.length * 12], [0, words.length], { extrapolateRight: "clamp" }));
  return <>{words.map((word, i) => <span key={`${word}-${i}`} style={{ backgroundColor: i === active ? "#ffe066" : "transparent" }}>{word}{i < words.length - 1 ? " " : ""}</span>)}</>;
};
