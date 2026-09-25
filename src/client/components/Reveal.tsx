import React, { useEffect, useRef, useState } from "react";

type RevealProps = {
  children: React.ReactNode;
  delayMs?: number;
  className?: string;
  direction?: "up" | "down" | "left" | "right" | "none";
};

export function Reveal({ children, delayMs = 0, className = "", direction = "up" }: RevealProps) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIsVisible(true);
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(element);
        }
      },
      {
        threshold: 0.01,
        rootMargin: "150px 0px 150px 0px",
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const getTransform = () => {
    if (isVisible) return "none";
    switch (direction) {
      case "up":
        return "translateY(32px) scale(0.985)";
      case "down":
        return "translateY(-32px) scale(0.985)";
      case "left":
        return "translateX(32px) scale(0.985)";
      case "right":
        return "translateX(-32px) scale(0.985)";
      case "none":
        return "scale(0.985)";
      default:
        return "translateY(32px) scale(0.985)";
    }
  };

  return (
    <div
      ref={ref}
      className={`reveal-wrapper ${className} ${isVisible ? "reveal-visible" : ""}`}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: getTransform(),
        transition: `opacity 500ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms, transform 500ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

type RevealGroupProps = {
  children: React.ReactNode;
  staggerMs?: number;
  className?: string;
};

export function RevealGroup({ children, staggerMs = 80, className = "" }: RevealGroupProps) {
  const childrenArray = React.Children.toArray(children);

  return (
    <div className={`reveal-group ${className}`}>
      {childrenArray.map((child, index) => (
        <Reveal key={index} delayMs={index * staggerMs}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
