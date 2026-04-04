"use client";

/**
 * Heartbeat Monitor — latency waveforms flowing like a real-time performance monitor
 * Monochrome dark style
 */
export function HeartbeatMonitor({ className }: { className?: string }) {
  const waves = [
    { y: 60, amplitude: 25, label: "create", opacity: 0.5, speed: "4s", dashOffset: 0 },
    { y: 120, amplitude: 18, label: "connect", opacity: 0.35, speed: "3.5s", dashOffset: 100 },
    { y: 180, amplitude: 30, label: "goto", opacity: 0.45, speed: "5s", dashOffset: 200 },
    { y: 240, amplitude: 12, label: "release", opacity: 0.3, speed: "3s", dashOffset: 50 },
  ];

  function makePulsePath(baseY: number, amp: number): string {
    const segments: string[] = [`M0,${baseY}`];
    for (let x = 0; x <= 400; x += 2) {
      const y = baseY
        - Math.sin((x / 40) * Math.PI) * amp * 0.6
        - Math.sin((x / 18) * Math.PI) * amp * 0.3
        - Math.sin((x / 60) * Math.PI) * amp * 0.4;
      segments.push(`L${x},${Math.round(y * 10) / 10}`);
    }
    return segments.join(" ");
  }

  return (
    <svg viewBox="0 0 400 300" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="hm-fade-l" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-background)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--color-background)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hm-fade-r" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-background)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--color-background)" stopOpacity="1" />
        </linearGradient>
        <clipPath id="hm-clip">
          <rect x="0" y="0" width="400" height="300" />
        </clipPath>
      </defs>

      {waves.map((wave, i) => {
        const pathD = makePulsePath(wave.y, wave.amplitude);
        const pathLen = 800;
        return (
          <g key={i} clipPath="url(#hm-clip)">
            {/* Grid line */}
            <line x1="0" y1={wave.y} x2="400" y2={wave.y} stroke="var(--color-foreground)" strokeWidth="0.5" opacity="0.06" />

            {/* Label */}
            <text x="8" y={wave.y - wave.amplitude - 6} fontSize="9" fontFamily="var(--font-mono)" fill="var(--color-foreground)" opacity="0.2" letterSpacing="0.05em" style={{ textTransform: "uppercase" }}>
              {wave.label}
            </text>

            {/* Animated wave */}
            <path
              d={pathD}
              stroke="var(--color-foreground)"
              strokeWidth="1.5"
              opacity={wave.opacity}
              fill="none"
              strokeDasharray={`${pathLen}`}
              strokeDashoffset={wave.dashOffset}
            >
              <animate
                attributeName="stroke-dashoffset"
                from={pathLen}
                to={-pathLen}
                dur={wave.speed}
                repeatCount="indefinite"
              />
            </path>

            {/* Scanning dot */}
            <circle r="2.5" fill="var(--color-foreground)" opacity={wave.opacity * 0.8}>
              <animateMotion dur={wave.speed} repeatCount="indefinite">
                <mpath href={`#hm-path-${i}`} />
              </animateMotion>
            </circle>
            <path id={`hm-path-${i}`} d={pathD} fill="none" />

            {/* Fill under curve */}
            <path
              d={pathD + ` L400,${wave.y} L0,${wave.y} Z`}
              fill="var(--color-foreground)"
              opacity={0.02}
            />
          </g>
        );
      })}

      {/* Fade edges */}
      <rect x="0" y="0" width="50" height="300" fill="url(#hm-fade-l)" />
      <rect x="350" y="0" width="50" height="300" fill="url(#hm-fade-r)" />
    </svg>
  );
}
