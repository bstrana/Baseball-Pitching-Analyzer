// YBC (Your Ball Club) home-plate badge logo, shared between this component
// and the static pre-React splash markup in index.html so the two look
// identical and the transition between them is seamless once the app
// finishes booting. The asset lives at public/ybc-logo.svg.
export function YbcMark({ size = 96 }: { size?: number }) {
  return <img src="/ybc-logo.svg" width={size} height={size} alt="YBC logo" />;
}

// Full-screen splash shown while the app is booting (Keycloak init, initial
// bundle load) and reused as the Suspense fallback while the heavy
// PoseDetector/TensorFlow chunk loads, so opening the app and switching
// into a tracker both show the same branded loading state instead of bare
// "Loading..." text.
export function SplashScreen({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-white">
      <YbcMark size={88} />
      <div className="text-center">
        <p className="text-sm font-bold text-slate-900 uppercase tracking-[0.2em]">Your Ball Club</p>
        <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">{label}</p>
      </div>
      <div className="ybc-loading-line w-36 h-1 rounded-full bg-slate-200" />
    </div>
  );
}
