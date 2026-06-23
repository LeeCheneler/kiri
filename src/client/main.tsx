import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./app.css";
// KaTeX's stylesheet renders the maths the markdown pipeline emits via
// rehype-katex. Loaded globally here so every markdown surface can typeset.
import "katex/dist/katex.min.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
