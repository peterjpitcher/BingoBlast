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
    active: "w-32 h-32 text-6xl bg-[#005131] border-8 border-white text-white shadow-[0_0_28px_rgba(165,118,38,0.4)] scale-110 z-10 animate-bounce-slight",
    called: "w-10 h-10 text-sm bg-[#0f6846] border-2 border-[#1f7c58] text-white opacity-80",
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
