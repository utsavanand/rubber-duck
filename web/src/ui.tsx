import { createContext, useCallback, useContext, useState } from "react";

// ── Modal ──────────────────────────────────────────────────────────────
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 28,
          width: 480,
          maxWidth: "90vw",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.25)",
          border: "1px solid #e8e8eb",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 19,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          <button onClick={onClose} style={iconBtn}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 16,
  cursor: "pointer",
  color: "#6b7280",
};

// ── Form fields ────────────────────────────────────────────────────────
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span
        style={{
          display: "block",
          fontSize: 13,
          color: "#374151",
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #d4d4d8",
  borderRadius: 8,
  fontSize: 14,
  boxSizing: "border-box",
  background: "#fff",
  color: "#0d0d0d",
};

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  size = "md",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const cls = `rd-btn rd-btn-${variant}${size === "sm" ? " rd-btn-sm" : ""}`;
  return (
    <button className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────
type Toast = { id: number; text: string; kind: "ok" | "err" };
const ToastCtx = createContext<(text: string, kind?: "ok" | "err") => void>(
  () => {},
);

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.floor(performance.now());
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 200 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: t.kind === "err" ? "#fef2f2" : "#f0fdf4",
              color: t.kind === "err" ? "#991b1b" : "#166534",
              border: `1px solid ${t.kind === "err" ? "#fecaca" : "#bbf7d0"}`,
              borderRadius: 8,
              padding: "10px 14px",
              marginTop: 8,
              fontSize: 14,
              maxWidth: 360,
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
