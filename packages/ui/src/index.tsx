import type { PropsWithChildren, ReactNode } from "react";

export interface NavigationItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export function DesktopShell({
  brand,
  subtitle,
  navigation,
  activeId,
  onNavigate,
  header,
  children,
}: PropsWithChildren<{
  brand: string;
  subtitle: string;
  navigation: NavigationItem[];
  activeId: string;
  onNavigate?: (id: string) => void;
  header: ReactNode;
}>) {
  return (
    <div className="desktop-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-hidden="true">K</div>
        <div className="brand-copy">
          <strong>{brand}</strong>
          <span>{subtitle}</span>
        </div>
        <nav className="navigation" aria-label="主导航">
          {navigation.map((item) => (
            <button
              className={item.id === activeId ? "nav-item is-active" : "nav-item"}
              key={item.id}
              onClick={() => onNavigate?.(item.id)}
              type="button"
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="presence-dot" />
          服务连接正常
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">{header}</header>
        <section className="workspace-content">{children}</section>
      </main>
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  tone = "violet",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "violet" | "cyan" | "green" | "orange";
}) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: PropsWithChildren<{ title: string; action?: ReactNode; className?: string }>) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "success" | "warning" | "danger" | "info" }>) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}
