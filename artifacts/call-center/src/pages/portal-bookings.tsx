import BookingsPage from "@/pages/bookings";

export default function PortalBookings({ companyId }: { companyId: number }) {
  const url = new URL(window.location.href);
  const expected = String(companyId);

  if (url.searchParams.get("companyId") !== expected) {
    url.searchParams.set("companyId", expected);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return <BookingsPage />;
}
