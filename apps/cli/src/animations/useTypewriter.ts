/**
 * Typewriter effect hook for character-by-character text reveal.
 */

import { useState, useEffect, useRef } from 'react';

export interface UseTypewriterOptions {
  speed?: number; // milliseconds per character
  startDelay?: number; // delay before starting
  onComplete?: () => void;
}

export function useTypewriter(
  text: string,
  options: UseTypewriterOptions = {}
): { displayText: string; isComplete: boolean; reset: () => void } {
  const { speed = 30, startDelay = 0, onComplete } = options;
  const [displayText, setDisplayText] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    // Reset when text changes
    setDisplayText('');
    setIsComplete(false);
    indexRef.current = 0;

    if (!text) {
      setIsComplete(true);
      return;
    }

    let interval: ReturnType<typeof setInterval>;

    const startTimeout = setTimeout(() => {
      interval = setInterval(() => {
        if (indexRef.current < text.length) {
          indexRef.current += 1;
          setDisplayText(text.slice(0, indexRef.current));
        } else {
          clearInterval(interval);
          setIsComplete(true);
          onComplete?.();
        }
      }, speed);
    }, startDelay);

    return () => {
      clearTimeout(startTimeout);
      clearInterval(interval);
    };
  }, [text, speed, startDelay, onComplete]);

  const reset = () => {
    setDisplayText('');
    setIsComplete(false);
    indexRef.current = 0;
  };

  return { displayText, isComplete, reset };
}
