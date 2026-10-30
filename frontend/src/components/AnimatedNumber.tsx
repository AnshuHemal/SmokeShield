import { animate, useMotionValue, useTransform, motion } from "framer-motion";
import { useEffect } from "react";

/** Counts smoothly from the previous value to the new one. */
export function AnimatedNumber({ value, format = (n: number) => Math.round(n).toString() }: { value: number; format?: (n: number) => string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, format);
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.8, ease: "easeOut" });
    return () => controls.stop();
  }, [value, mv]);
  return <motion.span>{text}</motion.span>;
}
