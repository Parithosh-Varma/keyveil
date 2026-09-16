import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "./landing/Landing";

// Prerender entry: bundled with esbuild (css emptied), rendered to stdout.
process.stdout.write(renderToStaticMarkup(<Landing />));
