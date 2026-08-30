// YBC (Your Ball Club) logo mark, shared between this component and the
// static pre-React splash markup in index.html so the two look identical
// and the transition between them is seamless once the app finishes
// booting.
export function YbcMark({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="YBC logo">
      <defs>
        <linearGradient id="ybc-mark-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill="url(#ybc-mark-grad)" stroke="#0c4a6e" strokeWidth="2" />
      <path
        d="M 12 32 A 42 42 0 0 0 12 68"
        fill="none"
        stroke="#e0f2fe"
        strokeWidth="1.5"
        strokeDasharray="3 4"
        opacity="0.55"
      />
      <path
        d="M 88 32 A 42 42 0 0 1 88 68"
        fill="none"
        stroke="#e0f2fe"
        strokeWidth="1.5"
        strokeDasharray="3 4"
        opacity="0.55"
      />
      <text
        x="50"
        y="61"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="800"
        fontSize="32"
        letterSpacing="1"
        fill="#ffffff"
      >
        YBC
      </text>
    </svg>
  );
}

// Full-screen splash shown while the app is booting (Keycloak init, initial
// bundle load) and reused as the Suspense fallback while the heavy
// PoseDetector/TensorFlow chunk loads, so opening the app and switching
// into a tracker both show the same branded loading state instead of bare
// "Loading..." text.
export function SplashScreen({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-slate-950">
      <div className="relative">
        <YbcMark size={88} />
        <div className="absolute -inset-2 rounded-full border-2 border-sky-500/30 border-t-sky-400 animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-sm font-bold text-white uppercase tracking-[0.2em]">Your Ball Club</p>
        <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">{label}</p>
      </div>
    </div>
  );
}
