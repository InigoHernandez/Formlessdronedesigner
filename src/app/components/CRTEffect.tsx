// CRT effect — CSS only, no JavaScript animation loops
// Static scanlines, CSS-animated crawling band, static vignette
// Light mode: disable CRT entirely to avoid expensive GPU compositing

export function CRTEffect({ isDark = true }: { isDark?: boolean }) {
  // Light mode: disable CRT entirely to avoid expensive GPU compositing
  if (!isDark) return null;

  return (
    <>
      {/* Static scanlines */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 100,
          opacity: 1,
          background: `repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.08) 1px, rgba(0,0,0,0.08) 2px)`,
        }}
      />

      {/* Crawling band — CSS keyframes animation */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 100,
          background: 'linear-gradient(transparent 40%, rgba(255,255,255,0.015) 50%, transparent 60%)',
          backgroundSize: '100% 100%',
          animation: 'crt-crawl 10s linear infinite',
        }}
      />

      {/* Vignette */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 100,
          background: 'radial-gradient(ellipse at center, transparent 0%, transparent 50%, rgba(0,0,0,0.25) 75%, rgba(0,0,0,0.5) 100%)',
        }}
      />

      {/* Phosphor glow */}
      <div
        className="fixed pointer-events-none mix-blend-screen"
        style={{
          zIndex: 100,
          inset: '-20px',
          backgroundColor: 'rgba(0, 255, 180, 0.035)',
        }}
      />

      {/* Inject keyframes */}
      <style>{`
        @keyframes crt-crawl {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
      `}</style>
    </>
  );
}