import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import BookingSetup from "@/pages/booking-setup";
import { Button } from "@/components/ui/button";

export default function BookingSetupEntry() {
  const companyId = new URLSearchParams(window.location.search).get("companyId");

  return (
    <div className="space-y-4">
      {companyId && (
        <div className="flex w-full justify-stretch sm:justify-end">
          <Button asChild className="min-h-11 w-full gap-2 shadow-sm sm:min-h-9 sm:w-auto">
            <Link href={`/bookings/import?companyId=${companyId}`}>
              <Sparkles className="h-4 w-4" />
              Auto-fill from AI Settings
            </Link>
          </Button>
        </div>
      )}
      <BookingSetup />
    </div>
  );
}
