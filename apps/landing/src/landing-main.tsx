import { createRoot } from "react-dom/client";
import "../landing.css";
import { Landing } from "./landing/Landing";

createRoot(document.getElementById("root")!).render(<Landing />);
