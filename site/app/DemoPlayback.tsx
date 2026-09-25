"use client";
import { useEffect } from "react";

export default function DemoPlayback() {
  useEffect(() => {
    const video = document.getElementById("demo-video") as HTMLVideoElement;
    const toggle = document.getElementById("demo-pause")!;
    const replay = document.getElementById("demo-replay")!;
    const expand = document.getElementById("demo-expand")!;
    const progress = document.getElementById("video-progress")!;
    const step = document.getElementById("demo-step")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let requested = !reduced.matches, visible = false;
    const sync = () => {
      if (requested && visible && !document.hidden) video.play().catch(() => { toggle.textContent = "Play"; });
      else video.pause();
    };
    const onPlay = () => { toggle.textContent = "Pause"; };
    const onPause = () => { toggle.textContent = "Play"; };
    const onToggle = () => { requested = video.paused; sync(); };
    const onReplay = () => { video.currentTime = 0; requested = true; sync(); };
    const onMotion = () => { requested = !reduced.matches; sync(); };
    const onExpand = () => {
      const mobileVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
      if (mobileVideo.webkitEnterFullscreen) mobileVideo.webkitEnterFullscreen();
      else document.getElementById("animated-demo")?.requestFullscreen?.().catch(() => {});
    };
    const onTime = () => {
      progress.style.width = (video.duration ? video.currentTime / video.duration * 100 : 0) + "%";
      step.textContent = video.currentTime < 6 ? "An agent at work" : video.currentTime < 16 ? "Running the checkout tests" : video.currentTime < 23 ? "Read and pin a reply" : "Return to the saved message";
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .15 });
    observer.observe(video);
    video.addEventListener("play", onPlay); video.addEventListener("pause", onPause); video.addEventListener("timeupdate", onTime);
    toggle.addEventListener("click", onToggle); replay.addEventListener("click", onReplay); expand.addEventListener("click", onExpand);
    document.addEventListener("visibilitychange", sync); reduced.addEventListener("change", onMotion);
    return () => {
      observer.disconnect(); video.pause();
      video.removeEventListener("play", onPlay); video.removeEventListener("pause", onPause); video.removeEventListener("timeupdate", onTime);
      toggle.removeEventListener("click", onToggle); replay.removeEventListener("click", onReplay); expand.removeEventListener("click", onExpand);
      document.removeEventListener("visibilitychange", sync); reduced.removeEventListener("change", onMotion);
    };
  }, []);
  return null;
}
