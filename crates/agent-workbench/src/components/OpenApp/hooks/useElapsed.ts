import { useState, useEffect, useRef } from 'react';

/**
 * Hook to track elapsed time during streaming.
 * Returns elapsed milliseconds, updated every second while active.
 */
export function useElapsed(isActive: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isActive) {
      // Start timing
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }

      // Update every second
      intervalRef.current = setInterval(() => {
        if (startTimeRef.current !== null) {
          setElapsed(Date.now() - startTimeRef.current);
        }
      }, 1000);
    } else {
      // Stop timing
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      startTimeRef.current = null;
      setElapsed(0);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive]);

  return elapsed;
}

/**
 * Format milliseconds as MM:SS
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
