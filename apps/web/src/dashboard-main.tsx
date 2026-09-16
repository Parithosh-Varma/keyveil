import { createRoot } from "react-dom/client";
import "./dashboard/dashboard.css";
import { Dashboard } from "./dashboard/Dashboard";

createRoot(document.getElementById("root")!).render(<Dashboard />);
