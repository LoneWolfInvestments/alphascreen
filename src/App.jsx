// src/App.jsx
import React, { useState } from "react";
import "./styles.css";
import Overview from "./components/Overview";
import FundamentalScreener from "./components/FundamentalScreener";
import TechnicalAnalysis from "./components/TechnicalAnalysis";
import VixDashboard from "./components/VixDashboard";
import PortfolioAllocation from "./components/PortfolioAllocation";
import Positioning from "./components/Positioning";
import AiAnalyst from "./components/AiAnalyst";

const TABS = [
  { key: "overview", label: "Overview", Component: Overview },
  { key: "fundamental", label: "Fundamental Screener", Component: FundamentalScreener },
  { key: "technical", label: "Technical Analysis", Component: TechnicalAnalysis },
  { key: "vix", label: "VIX Dashboard", Component: VixDashboard },
  { key: "portfolio", label: "Portfolio Allocation", Component: PortfolioAllocation },
  { key: "positioning", label: "Positioning / Bottleneck", Component: Positioning },
  { key: "ai", label: "AI Analyst", Component: AiAnalyst },
];

export default function App() {
  const [active, setActive] = useState("overview");
  const ActiveComponent = TABS.find((t) => t.key === active).Component;

  return (
    <div>
      <header>
        <h1>Alpha<span>Screen</span></h1>
      </header>
      <nav>
        {TABS.map((t) => (
          <button key={t.key} className={active === t.key ? "active" : ""} onClick={() => setActive(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        <ActiveComponent />
      </main>
    </div>
  );
}
