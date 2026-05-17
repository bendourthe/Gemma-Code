import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles/globals.css";
import { readActiveRoute } from "./lib/persistence";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Nexus shell: #root element missing");
}

// Restore the last route the user was on (single-window app).
const initial = readActiveRoute();
if (initial && initial !== window.location.pathname) {
  window.history.replaceState(null, "", initial);
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
