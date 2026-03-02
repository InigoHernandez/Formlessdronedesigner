import { useState } from 'react';
import { DrawingCanvas } from './components/DrawingCanvas';
import { ThemeProvider } from './components/ThemeContext';
import { SplashScreen } from './components/SplashScreen';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <ThemeProvider>
      {showSplash && <SplashScreen onEnter={() => setShowSplash(false)} />}
      <div
        className="w-screen h-screen fixed inset-0 overflow-hidden"
        style={{ backgroundColor: 'var(--fm-bg)', transition: 'background-color 300ms ease' }}
      >
        <DrawingCanvas />
      </div>
    </ThemeProvider>
  );
}
