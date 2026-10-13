"use client";

export type LindenMood = "idle" | "think" | "happy" | "surprised";

export default function LindenDev({ size = 120, mood = "idle" }: { size?: number; mood?: LindenMood }) {
  return (
    <div className={`ld-root ld-${mood}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <ellipse className="ld-shadow" cx="60" cy="112" rx="26" ry="5" fill="#1E1B16" opacity="0.12" />
        <g className="ld-body">
          <rect x="38" y="62" width="44" height="40" rx="14" fill="#33291D" />
          <rect x="46" y="62" width="28" height="40" rx="10" fill="#221A11" />
          <rect x="55" y="70" width="10" height="22" rx="3" fill="#B67F2E" opacity="0.9" />
          <circle cx="60" cy="76" r="1.6" fill="#EFE4CC" />
          <circle cx="60" cy="84" r="1.6" fill="#EFE4CC" />
          <g className="ld-arm-l">
            <rect x="28" y="64" width="12" height="26" rx="6" fill="#33291D" />
            <circle cx="34" cy="92" r="5" fill="#E8C49A" />
          </g>
          <g className="ld-arm-r">
            <rect x="80" y="64" width="12" height="26" rx="6" fill="#33291D" />
            <circle cx="86" cy="92" r="5" fill="#E8C49A" />
          </g>
        </g>
        <g className="ld-head">
          <circle cx="60" cy="38" r="22" fill="#E8C49A" />
          <path d="M38 34 Q40 16 60 16 Q80 16 82 34 Q76 26 60 26 Q44 26 38 34 Z" fill="#4A3826" />
          <g className="ld-glasses" stroke="#1E1B16" strokeWidth="2" fill="none">
            <circle cx="51" cy="38" r="7" />
            <circle cx="69" cy="38" r="7" />
            <path d="M58 38 h4 M44 37 l-5 -2 M76 37 l5 -2" />
            <rect className="ld-glint" x="46" y="33" width="4" height="10" rx="2" fill="#FFFFFF" opacity="0" stroke="none" />
          </g>
          <g className="ld-eyes">
            <circle className="ld-eye" cx="51" cy="38" r="2.4" fill="#1E1B16" />
            <circle className="ld-eye" cx="69" cy="38" r="2.4" fill="#1E1B16" />
          </g>
          <path className="ld-brow ld-brow-l" d="M46 30 q5 -3 9 -1" stroke="#4A3826" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path className="ld-brow ld-brow-r" d="M65 29 q5 -2 9 1" stroke="#4A3826" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path className="ld-mouth" d="M53 49 q7 5 14 0" stroke="#8A5A3A" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <circle cx="44" cy="45" r="2.6" fill="#DFA075" opacity="0.55" />
          <circle cx="76" cy="45" r="2.6" fill="#DFA075" opacity="0.55" />
        </g>
      </svg>
      <style jsx>{`
        .ld-root {
          display: inline-block;
          position: relative;
        }
        .ld-body,
        .ld-head {
          transform-origin: 60px 100px;
          animation: ldBreath 3.4s ease-in-out infinite;
        }
        .ld-head {
          transform-origin: 60px 60px;
          animation: ldHead 6s ease-in-out infinite;
        }
        .ld-eye {
          animation: ldBlink 4.6s infinite;
        }
        .ld-arm-r {
          transform-origin: 86px 66px;
        }
        .ld-arm-l {
          transform-origin: 34px 66px;
        }
        .ld-idle .ld-arm-r {
          animation: ldWaveSoft 7s ease-in-out infinite;
        }
        .ld-think .ld-head {
          animation: ldThink 2.6s ease-in-out infinite;
        }
        .ld-think .ld-arm-r {
          transform: rotate(-58deg) translate(-6px, -2px);
        }
        .ld-think .ld-glint {
          opacity: 0.7;
          animation: ldGlint 1.6s linear infinite;
        }
        .ld-happy .ld-root,
        .ld-happy .ld-body,
        .ld-happy .ld-head {
          animation: ldHop 0.9s ease-in-out infinite;
        }
        .ld-happy .ld-arm-l {
          transform: rotate(40deg);
        }
        .ld-happy .ld-arm-r {
          transform: rotate(-40deg);
        }
        .ld-happy .ld-mouth {
          d: path("M52 48 q8 8 16 0");
        }
        .ld-surprised .ld-brow-l,
        .ld-surprised .ld-brow-r {
          transform: translateY(-3px);
        }
        .ld-surprised .ld-mouth {
          d: path("M57 49 a4 4 0 1 0 6 0 a4 4 0 1 0 -6 0");
        }
        .ld-surprised .ld-glint {
          opacity: 0.8;
        }
        .ld-brow {
          transition: transform 0.25s ease;
        }
        @keyframes ldBreath {
          0%,
          100% {
            transform: scaleY(1);
          }
          50% {
            transform: scaleY(1.02);
          }
        }
        @keyframes ldHead {
          0%,
          100% {
            transform: rotate(0deg);
          }
          30% {
            transform: rotate(2.5deg);
          }
          65% {
            transform: rotate(-2deg);
          }
        }
        @keyframes ldBlink {
          0%,
          46%,
          52%,
          100% {
            transform: scaleY(1);
          }
          49% {
            transform: scaleY(0.08);
          }
        }
        @keyframes ldWaveSoft {
          0%,
          78%,
          100% {
            transform: rotate(0deg);
          }
          84% {
            transform: rotate(-46deg);
          }
          89% {
            transform: rotate(-30deg);
          }
          94% {
            transform: rotate(-50deg);
          }
        }
        @keyframes ldThink {
          0%,
          100% {
            transform: rotate(-2deg);
          }
          50% {
            transform: rotate(3deg);
          }
        }
        @keyframes ldGlint {
          0% {
            transform: translateX(-4px);
            opacity: 0;
          }
          40% {
            opacity: 0.8;
          }
          100% {
            transform: translateX(16px);
            opacity: 0;
          }
        }
        @keyframes ldHop {
          0%,
          100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-4px);
          }
        }
      `}</style>
    </div>
  );
}
