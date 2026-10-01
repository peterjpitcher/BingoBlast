import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

type CssLength = number | string;

function toLength(value: CssLength): string {
  return typeof value === "number" ? `${value}px` : value;
}

interface BingoBallProps {
  number: number;
  /**
   * Diameter: a number of pixels, or any CSS length (the TV sizes its ball in
   * vh). 56 is the claim ball on a phone, 176 the host's, 200 the follower's.
   */
  size?: CssLength;
  /** The numeral's size as a share of the diameter: about 0.43 for a small claim ball, 0.52 to 0.55 for a main ball, 0.68 for the TV's. */
  numberScale?: number;
  /** The border's width as a share of the diameter. It never goes below 3px. */
  borderScale?: number;
  /** A gold ring for the latest ball: its width in pixels or as a CSS length (4 on a phone, 8 on the TV). */
  ring?: CssLength;
  /** Claim check: a tick for a number that was called, a cross for one that was not. */
  badge?: "tick" | "cross";
  /** The surface the ball sits on, so the badge's border matches it. */
  surface?: "card" | "deep";
  className?: string;
  style?: React.CSSProperties;
  /** TEMPORARY: the old size presets. Ignored; removed once no screen passes it. */
  variant?: "normal" | "active" | "called" | "mini";
}

/**
 * The bingo ball: Anchor green with a cream border and the number in Outfit
 * 700 (not the serif), white, tabular. One component for every size on every
 * screen; everything scales from the diameter.
 */
const BingoBall = ({
  number,
  size = 56,
  numberScale = 0.5,
  borderScale = 0.035,
  ring,
  badge,
  surface = "card",
  className,
  style,
}: BingoBallProps): React.ReactElement => {
  const ringShadow = ring === undefined ? undefined : `0 0 0 ${toLength(ring)} var(--anchor-gold-bright)`;
  const ballStyle = {
    "--ball": toLength(size),
    width: "var(--ball)",
    height: "var(--ball)",
    fontSize: `calc(var(--ball) * ${numberScale})`,
    borderWidth: `max(3px, calc(var(--ball) * ${borderScale}))`,
    ...(ringShadow ? { boxShadow: ringShadow } : {}),
    ...style,
  } as React.CSSProperties;

  return (
    <div
      className={cn(
        // shrink-0 keeps balls round in a flex row: they overflow rather than squash.
        "relative flex shrink-0 items-center justify-center rounded-full border-solid bg-anchor-green font-sans font-bold leading-none tracking-[-0.03em] text-white tabular-nums lining-nums",
        badge === "cross" ? "border-anchor-danger" : "border-anchor-cream-text",
        className,
      )}
      style={ballStyle}
    >
      {number}
      {badge ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute flex items-center justify-center rounded-full border-solid text-white",
            badge === "tick" ? "bg-anchor-success" : "bg-anchor-danger",
            surface === "deep" ? "border-anchor-green-deep" : "border-anchor-green-card",
          )}
          style={{
            width: "calc(var(--ball) * 0.38)",
            height: "calc(var(--ball) * 0.38)",
            right: "calc(var(--ball) * -0.08)",
            top: "calc(var(--ball) * -0.08)",
            borderWidth: "max(2px, calc(var(--ball) * 0.02))",
          }}
        >
          {badge === "tick" ? (
            <Check className="h-[60%] w-[60%]" strokeWidth={3.5} />
          ) : (
            <X className="h-[60%] w-[60%]" strokeWidth={3.5} />
          )}
        </span>
      ) : null}
    </div>
  );
};

interface NumberChipProps {
  number: number;
  /** Diameter: 52 on the host's phone, 56 on the follower's; the TV passes a CSS length. */
  size?: CssLength;
  /** The numeral's size as a share of the diameter. */
  numberScale?: number;
  /** The newest call takes the bright gold border. */
  latest?: boolean;
  className?: string;
}

/** A called number in a recent-calls strip: a round chip on the raised green. */
const NumberChip = ({ number, size = 52, numberScale = 0.39, latest = false, className }: NumberChipProps): React.ReactElement => {
  const chipStyle = {
    "--chip": toLength(size),
    width: "var(--chip)",
    height: "var(--chip)",
    fontSize: `calc(var(--chip) * ${numberScale})`,
  } as React.CSSProperties;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-2 bg-anchor-green-raised font-sans font-bold leading-none text-anchor-cream-text tabular-nums",
        latest ? "border-anchor-gold-bright" : "border-line-strong",
        className,
      )}
      style={chipStyle}
    >
      {number}
    </div>
  );
};

export { BingoBall, NumberChip };
