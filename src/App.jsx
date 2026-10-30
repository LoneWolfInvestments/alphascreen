// src/App.jsx
import React, { useState } from "react";
import "./styles.css";
import Opportunities from "./components/Opportunities";
import Overview from "./components/Overview";
import FundamentalScreener from "./components/FundamentalScreener";
import TechnicalAnalysis from "./components/TechnicalAnalysis";
import PortfolioAllocation from "./components/PortfolioAllocation";
import MarketStress from "./components/MarketStress";
import Mag7 from "./components/Mag7";
import SellSignals from "./components/SellSignals";
import ReallocationLog from "./components/ReallocationLog";
import AuthBar from "./components/AuthBar";

const TABS = [
  { key: "opportunities", label: "Opportunities", Component: Opportunities },
  { key: "stress", label: "Market Stress", Component: MarketStress },
  { key: "overview", label: "Overview (raw)", Component: Overview },
  { key: "fundamental", label: "Fundamental Screener", Component: FundamentalScreener },
  { key: "technical", label: "Technical Analysis", Component: TechnicalAnalysis },
  { key: "mag7", label: "MAG7", Component: Mag7 },
  { key: "portfolio", label: "Portfolio Allocation", Component: PortfolioAllocation },
  { key: "sell", label: "Sell Signals", Component: SellSignals },
  { key: "reallocation", label: "Reallocation Log", Component: ReallocationLog },
];

const TAB_ALIASES = {
  vix: "stress",
  positioning: "reallocation",
};

function initialTab() {
  if (typeof window === "undefined") return "opportunities";
  const requested = new URLSearchParams(window.location.search).get("tab");
  const key = TAB_ALIASES[requested] || requested;
  return TABS.some((tab) => tab.key === key) ? key : "opportunities";
}

export default function App() {
  const [active, setActive] = useState(initialTab);
  const ActiveComponent = TABS.find((t) => t.key === active).Component;

  return (
    <div>
      <header>
        <h1>Alpha<span>Screen</span></h1>
        <AuthBar />
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
