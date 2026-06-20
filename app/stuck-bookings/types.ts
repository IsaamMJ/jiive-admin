export interface StuckBookingUser {
  whatsappPhone: string;
  name: string;
}

export interface StuckBookingAddress {
  pincode: number | string;
  city: string;
}

export interface StuckBooking {
  id: string;
  patientName: string;
  testType: string;
  status: string;                      // payment_completed | awaiting_reschedule_choice
  appointmentDate: string;             // ISO
  appointmentTime: string;             // "08:00"
  appointmentSlotId: string | null;
  paymentBatchId: string | null;       // null for single bookings
  thyrocareCreateAttempts: number;     // auto-retries burned (cap 6)
  lastOrderError: string | null;
  lastOrderErrorAt: string | null;
  amount: number;                      // paise
  createdAt: string;                   // ISO
  user: StuckBookingUser;
  address: StuckBookingAddress | null;
}

export interface StuckBookingsResponse {
  count: number;
  bookings: StuckBooking[];
}

export interface Slot {
  id: string;
  time: string;     // "08:20"
  label: string;    // "08:20 - 08:40"
  recommended?: boolean;
}

export interface SlotsResponse {
  pincode: number | string;
  date: string;
  slots: Slot[];
}

const RETRY_CAP = 6;

export interface WhyStuck {
  dotClass: string;
  label: string;
}

/** Map a persisted lastOrderError into an operator-facing reason + colour. */
export function whyStuck(err: string | null): WhyStuck {
  if (!err) return { dotClass: "bg-slate-400", label: "Not yet attempted" };
  if (/insufficient balance/i.test(err))
    return { dotClass: "bg-orange-500", label: "Wallet empty — top up, then Retry" };
  if (/slot is not available/i.test(err))
    return { dotClass: "bg-red-500", label: "Slot full — Reschedule" };
  if (/missing_address|missing_dob/i.test(err))
    return { dotClass: "bg-slate-300", label: "Missing data — fix profile" };
  return { dotClass: "bg-slate-400", label: err };
}

export { RETRY_CAP };

/** ISO date → "YYYY-MM-DD" without timezone drift (handoff dates are midnight-UTC). */
export const toYmd = (iso: string) => iso.slice(0, 10);

export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
