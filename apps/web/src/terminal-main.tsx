import { createRoot } from "react-dom/client";
import "../styles.css";
import { Terminal } from "./terminal/Terminal";

createRoot(document.getElementById("root")!).render(<Terminal />);
