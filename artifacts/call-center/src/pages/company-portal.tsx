import { useLocation } from "wouter";
import type { AuthUser } from "@/App";
import CompanyPortalControlled from "./company-portal-controlled";
import PortalNotifications from "./portal-notifications";

export default function CompanyPortal({ user }: { user: AuthUser }) {
  const [location] = useLocation();
  if (location === "/portal/notifications" || location.startsWith("/portal/notifications/")) {
    return <PortalNotifications user={user} />;
  }
  return <CompanyPortalControlled user={user} />;
}
