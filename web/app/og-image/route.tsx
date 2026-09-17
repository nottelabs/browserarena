import { ImageResponse } from "next/og";
import { MARKETED_PROVIDER_NAMES } from "@/lib/providers";

export const runtime = "edge";

// Notte (the site's author) is kept in the third slot rather than leading the row.
const OG_PROVIDER_NAMES = (() => {
  const names = MARKETED_PROVIDER_NAMES.filter((name) => name !== "Notte");
  names.splice(2, 0, "Notte");
  return names;
})();

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#ffffff",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Diagonal stripe pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 14px, #e5e5e5 14px, #e5e5e5 15px)",
            opacity: 0.5,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: "64px",
              fontWeight: 700,
              color: "#0a0a0a",
              letterSpacing: "-0.02em",
            }}
          >
            The Browser Arena.
          </div>

          <div
            style={{
              fontSize: "28px",
              color: "#737373",
              maxWidth: "800px",
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            Open-source benchmarks comparing cloud browser providers
            on speed, reliability, and cost.
          </div>

          <div
            style={{
              display: "flex",
              gap: "20px",
              marginTop: "24px",
              fontSize: "20px",
              color: "#a3a3a3",
            }}
          >
            {OG_PROVIDER_NAMES.flatMap((name, i) => [
              ...(i > 0 ? [<span key={`sep-${name}`} style={{ color: "#d4d4d4" }}>·</span>] : []),
              <span key={name}>{name}</span>,
            ])}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: "32px",
            fontSize: "20px",
            color: "#a3a3a3",
          }}
        >
          browserarena.ai
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
