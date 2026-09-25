// src/App.jsx
import React, { useState } from "react";
import "./styles.css";
import Opportunities from "./components/Opportunities";
import Overview from "./components/Overview";
import FundamentalScreener from "./components/FundamentalScreener";
import TechnicalAnalysis from "./components/TechnicalAnalysis";
import VixDashboard from "./components/VixDashboard";
import PortfolioAllocation from "./components/PortfolioAllocation";
import Positioning from "./components/Positioning";
import Mag7 from "./components/Mag7";
import AiAnalyst from "./components/AiAnalyst";

const TABS = [
  { key: "opportunities", label: "Opportunities", Component: Opportunities },
  { key: "overview", label: "Overview (raw)", Component: Overview },
  { key: "fundamental", label: "Fundamental Screener", Component: FundamentalScreener },
  { key: "technical", label: "Technical Analysis", Component: TechnicalAnalysis },
  { key: "mag7", label: "MAG7", Component: Mag7 },
  { key: "vix", label: "VIX Dashboard", Component: VixDashboard },
  { key: "portfolio", label: "Portfolio Allocation", Component: PortfolioAllocation },
  { key: "positioning", label: "Positioning / Bottleneck", Component: Positioning },
  { key: "ai", label: "AI Analyst", Component: AiAnalyst },
];

export default function App() {
  const [active, setActive] = useState("opportunities");
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
