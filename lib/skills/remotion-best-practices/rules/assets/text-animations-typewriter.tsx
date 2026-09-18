import { interpolate, useCurrentFrame } from "remotion";
export const Typewriter = ({ text }: { text: string }) => {
  const frame = useCurrentFrame();
  const count = Math.min(text.length, Math.floor(interpolate(frame, [0, text.length * 2], [0, text.length], { extrapolateRight: "clamp" })));
  return <span>{text.slice(0, count)}{count < text.length ? "|" : ""}</span>;
};
