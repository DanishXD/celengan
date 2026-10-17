import { NavLink, Route, Routes } from "react-router-dom";
import {
  PiggyBank,
  Detective,
  ChartLine,
  Lightning,
  Scroll,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import Dashboard from "./pages/Dashboard";
import LeakRadar from "./pages/LeakRadar";
import FutureOracle from "./pages/FutureOracle";
import ActionDesk from "./pages/ActionDesk";
import AuditTrail from "./pages/AuditTrail";
import Settings from "./pages/Settings";

const NAV = [
  { to: "/", label: "Dashboard", icon: PiggyBank, end: true },
  { to: "/leaks", label: "Leak Radar", icon: Detective, end: false },
  { to: "/oracle", label: "Future Oracle", icon: ChartLine, end: false },
  { to: "/actions", label: "Action Desk", icon: Lightning, end: false },
  { to: "/audit", label: "Audit Trail", icon: Scroll, end: false },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal, end: false },
] as const;

function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/favicon.svg"
      alt="Celengan logo — a piggy bank"
      className={`rounded-[0.7rem] ${className ?? ""}`}
      aria-hidden
    />
  );
}

function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-5 py-6 lg:flex">
      <NavLink to="/" className="flex items-center gap-3">
        <BrandMark className="h-11 w-11" />
        <div>
          <div className="text-[15px] font-bold tracking-tight">Celengan</div>
          <div className="text-[11px] font-medium text-ink-soft">Detect · Simulate · Execute</div>
        </div>
      </NavLink>

      <nav className="mt-9 grid items-start gap-1" aria-label="Primary">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
                isActive
                  ? "bg-piggy text-[#F2F6EE]"
                  : "text-ink-soft hover:bg-surface hover:text-ink"
              }`
            }
          >
            <Icon size={19} weight="regular" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto grid gap-2 pr-2">
        <span className="chip chip-ink w-fit">Sandbox “Maya” · synthetic</span>
        <p className="text-[11px] leading-snug text-ink-faint">
          100% simulated account. No bank connections, no real data, deterministic core.
        </p>
      </div>
    </aside>
  );
}

function MobileTopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur-md lg:hidden">
      <BrandMark className="h-8 w-8" />
      <span className="text-[15px] font-bold tracking-tight">Celengan</span>
      <span className="chip chip-ink ml-auto">Synthetic sandbox</span>
    </header>
  );
}

function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 py-2 text-[9.5px] font-semibold tracking-tight transition-colors ${
              isActive ? "text-piggy" : "text-ink-faint"
            }`
          }
        >
          <Icon size={20} weight="regular" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr] lg:gap-0">
      <Sidebar />
      <div className="min-w-0">
        <MobileTopBar />
        <main className="mx-auto w-full max-w-[1160px] px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-14 lg:pt-9">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/leaks" element={<LeakRadar />} />
            <Route path="/oracle" element={<FutureOracle />} />
            <Route path="/actions" element={<ActionDesk />} />
            <Route path="/audit" element={<AuditTrail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
