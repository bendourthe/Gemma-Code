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

// Cold start always opens Chatbot (v2.2.4 Phase 1.1). A stored /coding,
// /images, /videos, or /settings path is not restored. Chatbot thread
// sub-paths under /chatbot/ still restore.
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
