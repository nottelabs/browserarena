import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          borderRadius: "102px",
          fontFamily: "sans-serif",
        }}
      >
        <span
          style={{
            fontSize: "256px",
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-6px",
          }}
        >
          BA
        </span>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
