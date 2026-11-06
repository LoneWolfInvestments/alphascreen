import React, { useState } from "react";
import "./styles.css";
import Today from "./components/Today";
import MyBook from "./components/MyBook";
import TechnicalAnalysis from "./components/TechnicalAnalysis";
import More from "./components/More";
import AuthBar from "./components/AuthBar";

const VIEWS = [
  { key: "today", label: "Today", Component: Today },
  { key: "book", label: "My holdings", Component: MyBook },
  { key: "setups", label: "Setups", Component: TechnicalAnalysis },
  { key: "more", label: "More", Component: More },
];

const ALIASES = {
  today: { view: "today" },
  opportunities: { view: "today" },
  overview: { view: "today" },
  book: { view: "book", section: "risk" },
  sell: { view: "book", section: "exits" },
  size: { view: "book", section: "size" },
  portfolio: { view: "book", section: "holdings" },
  journal: { view: "book", section: "journal" },
  setups: { view: "setups" },
  technical: { view: "setups" },
  more: { view: "more", section: "status" },
  stress: { view: "more", section: "stress" },
  vix: { view: "more", section: "stress" },
  fundamental: { view: "more", section: "fundamentals" },
  study: { view: "more", section: "study" },
  mag7: { view: "more", section: "mag7" },
  reallocation: { view: "more", section: "log" },
  positioning: { view: "more", section: "log" },
};

function readRoute() {
  if (typeof window === "undefined") return { view: "today", section: null };
  const params = new URLSearchParams(window.location.search);
  const key = params.get("tab") || "today";
  const alias = ALIASES[key] || { view: "today" };
  const view = VIEWS.some((item) => item.key === alias.view) ? alias.view : "today";
  return { view, section: params.get("section") || alias.section || null };
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const Active = VIEWS.find((item) => item.key === route.view)?.Component || Today;

  const go = (view, section) => {
    const params = new URLSearchParams();
    params.set("tab", view);
    if (section) params.set("section", section);
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", next);
    setRoute({ view, section: section || null });
  };

  return (
    <div>
      <header>
        <h1>Alpha<span>Screen</span></h1>
        <AuthBar />
      </header>
      <nav>
        {VIEWS.map((item) => (
          <button key={item.key} type="button" className={route.view === item.key ? "active" : ""} onClick={() => go(item.key, item.key === "book" ? "risk" : item.key === "more" ? "status" : null)}>
            {item.label}
          </button>
        ))}
      </nav>
      <main>
        {route.view === "book" ? <MyBook section={route.section} onSection={(section) => go("book", section)} /> : null}
        {route.view === "more" ? <More section={route.section} onSection={(section) => go("more", section)} /> : null}
        {route.view !== "book" && route.view !== "more" ? <Active /> : null}
      </main>
    </div>
  );
}
