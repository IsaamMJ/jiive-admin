export interface BookingUser {
  id: string;
  name: string;
  whatsappPhone: string;
  email?: string;
}

export interface BookingAddress {
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: number;
}

export interface Booking {
  id: string;
  patientName: string;
  testType: string;
  appointmentDate: string;   // YYYY-MM-DD
  appointmentTime: string;   // e.g. "09:30"
  status: string;
  amount: number;            // paise
  source: string;
  createdAt: string;         // ISO
  updatedAt: string;         // ISO
  refundStatus: string;      // 'none' | 'requested' | 'processed' | …
  thyrocareOrderId: string | null;
  thyrocareLeadId: string | null;
  // 'user' | 'thyrocare' | 'admin:<uuid>' | null
  cancelledBy: string | null;
  cancellationReason: string | null;
  user: BookingUser;
  address: BookingAddress;
}

export interface DayBucket {
  date: string;        // YYYY-MM-DD
  bookings: Booking[]; // already sorted by appointmentTime ASC
}
