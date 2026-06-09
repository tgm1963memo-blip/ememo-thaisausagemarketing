import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { getEffectiveTarget } from "./onboardingSteps";

const GOLD = "#D4AF37";

function getTooltipStyle(rect) {
  if (!rect) {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      maxWidth: 380,
      width: "calc(100vw - 32px)",
    };
  }

  const pad = 14;
  const cardW = Math.min(360, window.innerWidth - 32);
  const cardH = 220;
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeBelow = spaceBelow >= cardH + pad || rect.top < window.innerHeight / 2;

  let top = placeBelow ? rect.bottom + pad : rect.top - cardH - pad;
  let left = rect.left + rect.width / 2 - cardW / 2;
  left = Math.max(16, Math.min(left, window.innerWidth - cardW - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - cardH - 16));

  return {
    top,
    left,
    width: cardW,
    maxWidth: cardW,
    transform: "none",
  };
}

export default function OnboardingTour({ steps, onComplete, onSkip, onStepChange }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);

  const step = steps[index];
  const targetKey = getEffectiveTarget(step);
  const isLast = index === steps.length - 1;
  const isFirst = index === 0;

  const measureTarget = useCallback(() => {
    if (!targetKey) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${targetKey}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [targetKey]);

  useLayoutEffect(() => {
    measureTarget();
    const delayed = setTimeout(measureTarget, 150);
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);
    return () => {
      clearTimeout(delayed);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
    };
  }, [measureTarget, index]);

  useEffect(() => {
    onStepChange?.(step, index);
  }, [step, index, onStepChange]);

  if (!step) return null;

  const tooltipStyle = getTooltipStyle(rect);

  const handleNext = () => {
    if (isLast) onComplete?.();
    else setIndex(i => i + 1);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, fontFamily: "'Noto Sans Thai','Sarabun',sans-serif" }}>
      {rect ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            borderRadius: 10,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.78)",
            border: `2px solid ${GOLD}`,
            pointerEvents: "none",
            zIndex: 501,
            transition: "all 0.25s ease",
          }}
        />
      ) : (
        <div aria-hidden style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 501 }} />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        style={{
          position: "fixed",
          zIndex: 502,
          background: "#fff",
          borderRadius: 14,
          padding: "22px 22px 18px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
          boxSizing: "border-box",
          ...tooltipStyle,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600 }}>
            ขั้นที่ {index + 1} / {steps.length}
          </span>
          <button
            type="button"
            onClick={() => onSkip?.()}
            style={{ background: "none", border: "none", color: "#9CA3AF", fontSize: 11, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", padding: 0 }}
          >
            ข้ามทัวร์
          </button>
        </div>

        <div style={{ width: "100%", height: 4, background: "#F3F4F6", borderRadius: 99, marginBottom: 14, overflow: "hidden" }}>
          <div style={{ width: `${((index + 1) / steps.length) * 100}%`, height: "100%", background: GOLD, borderRadius: 99, transition: "width 0.25s ease" }} />
        </div>

        <h2 id="onboarding-title" style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#111" }}>
          {step.title}
        </h2>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "#4B5563", lineHeight: 1.65 }}>
          {step.desktopOnly && !targetKey
            ? `${step.body} (เมนูนี้อยู่ในแถบด้านซ้ายบนหน้าจอคอมพิวเตอร์)`
            : step.body}
        </p>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {!isFirst && (
            <button
              type="button"
              onClick={() => setIndex(i => i - 1)}
              style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", color: "#374151", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
            >
              ย้อนกลับ
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: GOLD, color: "#000", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            {isLast ? "เริ่มใช้งาน" : "ถัดไป →"}
          </button>
        </div>
      </div>
    </div>
  );
}
