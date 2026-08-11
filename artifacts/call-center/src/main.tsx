import { createRoot } from "react-dom/client";
import "./company-scope-fetch";
import "./messages-focus";
import "./call-unread-enhancer";
import App from "./App";
import PortalVisibilityAdmin from "@/components/portal-visibility-admin";
import "./index.css";
import "./layout-polish.css";
import "./mobile-accessibility.css";
import "./messages-mobile.css";

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <PortalVisibilityAdmin />
  </>,
);
