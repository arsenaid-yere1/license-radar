import Link from "next/link";
import type { ReactNode } from "react";
export function Shell({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <>
      <header className="site-header">
        <Link
          className="brand"
          href="/"
          aria-label="License Renewal Radar home"
        >
          <span className="radar-mark" aria-hidden="true">
            ◉
          </span>
          <span>
            License Renewal
            <br />
            <strong>Radar</strong>
          </span>
        </Link>
        {action ?? (
          <span className="header-note">
            A little clarity. A lot less chasing.
          </span>
        )}
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <span>License Renewal Radar</span>
        <span>Your practice, in good time.</span>
      </footer>
    </>
  );
}
