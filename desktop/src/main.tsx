import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles/globals.css";
import { normalizeActiveRoute, readActiveRoute } from "./lib/persistence";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Nexus shell: #root element missing");
}

// Restore the last route the user was on (single-window app). v2.2.3 Phase 1
// (1.2, U7): missing, "/", "/dashboard", and invalid stored paths all land on
// Local Chatbot; the five real module routes restore unchanged.
const initial = normalizeActiveRoute(readActiveRoute());
if (initial !== window.location.pathname) {
  window.history.replaceState(null, "", initial);
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
