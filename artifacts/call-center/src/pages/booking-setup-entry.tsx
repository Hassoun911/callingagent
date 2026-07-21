import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import BookingSetup from "@/pages/booking-setup";
import { Button } from "@/components/ui/button";

export default function BookingSetupEntry() {
  const companyId = new URLSearchParams(window.location.search).get("companyId");
  return (
    <div className="relative">
      {companyId && (
        <div className="fixed bottom-6 right-6 z-30">
          <Button asChild className="shadow-xl gap-2">
            <Link href={`/bookings/import?companyId=${companyId}`}>
              <Sparkles className="h-4 w-4" /> Auto-fill from AI Settings
            </Link>
          </Button>
        </div>
      )}
      <BookingSetup />
    </div>
  );
}
