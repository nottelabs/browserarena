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
          borderRadius: "38px",
          fontFamily: "sans-serif",
        }}
      >
        <span
          style={{
            fontSize: "96px",
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-2px",
          }}
        >
          BA
        </span>
      </div>
    ),
    { width: 192, height: 192 },
  );
}
