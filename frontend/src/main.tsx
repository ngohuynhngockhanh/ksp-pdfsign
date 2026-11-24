import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

try {
  const root = document.documentElement;
  const savedTheme = window.localStorage.getItem("ksp_theme");
  root.dataset.theme = savedTheme === "dark" ? "dark" : "light";
  const savedDensity = window.localStorage.getItem("ksp_density");
  root.dataset.density = savedDensity === "compact" ? "compact" : "comfortable";
} catch {
  // Ignore storage restrictions (e.g. private browsing / sandboxed context)
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
