"use client";
import { useEffect, useRef, useState } from "react";

export default function DuckScene() {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(true);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    setPaused(preference.matches);
    const change = () => setPaused(preference.matches);
    const page = () => setForeground(!document.hidden);
    preference.addEventListener("change", change);
    document.addEventListener("visibilitychange", page);
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
    if (root.current) observer.observe(root.current);
    return () => { preference.removeEventListener("change", change); document.removeEventListener("visibilitychange", page); observer.disconnect(); };
  }, []);
  return <div ref={root} className="ed-duck-scene" data-playing={!paused && visible && foreground}>
    <div className="ed-duck-stage ed-duck-stopmotion" role="img" aria-label="Three soft 3D ducks work together at a laptop: one types, one wears round glasses and watches the screen, and one raises a wing.">
      <div className="ed-duck-sprite" aria-hidden="true"/>
    </div>
    <button type="button" className="ed-duck-toggle" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Play duck animation' : 'Pause duck animation'}>{paused ? 'Play animation' : 'Pause animation'}<span aria-hidden="true">{paused ? '▷' : 'Ⅱ'}</span></button>
  </div>;
}
