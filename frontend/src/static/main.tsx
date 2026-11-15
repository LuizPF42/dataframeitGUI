import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { App } from "@/static/App";
import { restoreRedirectedPath } from "@/static/runtime/spa-fallback";

restoreRedirectedPath();

const container = document.getElementById("root");
if (!container) throw new Error("Elemento #root ausente em index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
