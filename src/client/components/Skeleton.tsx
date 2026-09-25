import React from "react";

type SkeletonProps = {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
};

export function Skeleton({ width = "100%", height = 20, borderRadius = 8, className = "", style = {} }: SkeletonProps) {
  return (
    <div
      className={`skeleton-pulse ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

export function BalanceSkeleton() {
  return (
    <div className="balance-skeleton-container" aria-label="Loading balance" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <Skeleton width={120} height={16} borderRadius={4} />
      <Skeleton width={200} height={48} borderRadius={8} style={{ margin: "6px 0" }} />
      <Skeleton width={140} height={18} borderRadius={4} />
    </div>
  );
}

export function ActivityRowSkeleton() {
  return (
    <div className="activity-row-skeleton" aria-label="Loading transaction" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <Skeleton width={40} height={40} borderRadius={20} />
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Skeleton width={80} height={18} borderRadius={4} />
          <Skeleton width={130} height={14} borderRadius={4} />
        </div>
      </div>
      <div>
        <Skeleton width={60} height={14} borderRadius={4} />
      </div>
    </div>
  );
}
