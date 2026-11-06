import React, { useState } from "react";
import "./styles.css";
import Signals from "./components/Signals";
import Mag7 from "./components/Mag7";
import MyBook from "./components/MyBook";
import More from "./components/More";
import AuthBar from "./components/AuthBar";
import { resolveRoute } from "./lib/appRoutes";

const VIEWS = [
  { key: "signals", label: "Signals" },
  { key: "mag7", label: "MAG7" },
  { key: "book", label: "My holdings" },
  { key: "more", label: "More" },
];

export default function App() {
  const [route, setRoute] = useState(() => (
    typeof window === "undefined" ? { view: "signals", section: null, symbol: null } : resolveRoute(window.location.search)
  ));

  const go = (view, section) => {
    const params = new URLSearchParams();
    params.set("tab", view);
    if (section) params.set("section", section);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    setRoute({ view, section: section || null, symbol: null });
  };

  return (
    <div>
      <header>
        <h1>Alpha<span>Screen</span></h1>
        <AuthBar />
      </header>
      <nav>
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={route.view === item.key ? "active" : ""}
            onClick={() => go(item.key, item.key === "book" ? "risk" : item.key === "more" ? "status" : null)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main>
        {route.view === "signals" ? (
          <Signals symbol={route.symbol} onOpenSize={() => go("book", "size")} />
        ) : null}
        {route.view === "mag7" ? <Mag7 /> : null}
        {route.view === "book" ? <MyBook section={route.section} onSection={(section) => go("book", section)} /> : null}
        {route.view === "more" ? <More section={route.section} onSection={(section) => go("more", section)} /> : null}
      </main>
    </div>
  );
}
