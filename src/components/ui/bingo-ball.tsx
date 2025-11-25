import * as React from "react";
import { cn } from "@/lib/utils";

interface BingoBallProps {
  number: number;
  variant?: "normal" | "active" | "called" | "mini";
  className?: string;
}

// Bingo colors based on standard ranges (optional, but nice for polish)
const getBallColor = (num: number) => {
  if (num <= 18) return "border-red-500 text-red-500"; // 1-18
  if (num <= 36) return "border-yellow-500 text-yellow-500"; // 19-36
  if (num <= 54) return "border-green-500 text-green-500"; // 37-54
  if (num <= 72) return "border-blue-500 text-blue-500"; // 55-72
  return "border-purple-500 text-purple-500"; // 73-90
};

const BingoBall = ({ number, variant = "normal", className }: BingoBallProps) => {
  const colorClass = getBallColor(number);
  
  const variants = {
    normal: "w-16 h-16 text-2xl bg-white border-4 shadow-md text-slate-900 font-bold",
    active: "w-32 h-32 text-6xl bg-gradient-to-br from-white to-slate-200 border-8 shadow-[0_0_30px_rgba(236,72,153,0.6)] scale-110 z-10 animate-bounce-slight",
    called: "w-10 h-10 text-sm bg-slate-800 border-2 border-slate-600 text-slate-400 opacity-50",
    mini: "w-8 h-8 text-xs bg-white border-2 font-bold",
  };

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center transition-all duration-300",
        variants[variant],
        variant === 'active' ? colorClass : '', // Only color the active ball for now, or maybe all white balls?
        // Let's style the text color for normal balls too
        (variant === 'normal' || variant === 'mini') ? colorClass : '',
        className
      )}
    >
      {number}
    </div>
  );
};

export { BingoBall };
