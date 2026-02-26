import { DrawingCanvas } from './components/DrawingCanvas';
import { ThemeProvider } from './components/ThemeContext';

export default function App() {
  return (
    <ThemeProvider>
      <div
        className="w-screen h-screen fixed inset-0 overflow-hidden"
        style={{ backgroundColor: 'var(--fm-bg)', transition: 'background-color 300ms ease' }}
      >
        <DrawingCanvas />
      </div>
    </ThemeProvider>
  );
}
