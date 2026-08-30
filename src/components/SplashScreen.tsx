// YBC (Your Ball Club) home-plate badge logo, shared between this component
// and the static pre-React splash markup in index.html so the two look
// identical and the transition between them is seamless once the app
// finishes booting.
export function YbcMark({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="YBC logo">
      <polygon
        points="30,24 170,24 170,100 100,176 30,100"
        fill="#ffffff"
        stroke="#dd6b26"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <text
        x="102"
        y="126"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="900"
        fontSize="68"
        letterSpacing="-2"
        fill="#2b1810"
      >
        YBC
      </text>
      <text
        x="99"
        y="122"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="900"
        fontSize="68"
        letterSpacing="-2"
        fill="#dd6b26"
        stroke="#2b1810"
        strokeWidth="2.5"
        paintOrder="stroke fill"
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
        <div className="absolute -inset-2 rounded-full border-2 border-orange-500/30 border-t-orange-400 animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-sm font-bold text-white uppercase tracking-[0.2em]">Your Ball Club</p>
        <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">{label}</p>
      </div>
    </div>
  );
}
