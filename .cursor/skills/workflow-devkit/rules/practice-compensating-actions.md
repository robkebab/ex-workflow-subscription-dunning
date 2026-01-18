# practice-compensating-actions

**Impact: MEDIUM (handles partial failures)**

For multi-step workflows, implement compensating actions (rollback) when later steps fail after earlier steps succeeded.

## The Problem

```typescript
export async function bookTrip(details: TripDetails) {
  "use workflow";
  
  await bookFlight(details.flight)  // Succeeds
  await bookHotel(details.hotel)    // Succeeds
  await bookCar(details.car)        // FAILS!
  
  // Flight and hotel are booked but car failed
  // Customer is left in inconsistent state
}
```

## Solution: Saga Pattern

```typescript
export async function bookTripWorkflow(tripDetails: TripDetails) {
  "use workflow";
  
  let flightBooking = null
  let hotelBooking = null
  let carBooking = null
  
  try {
    // Book in sequence, tracking each booking
    flightBooking = await bookFlight(tripDetails.flight)
    hotelBooking = await bookHotel(tripDetails.hotel)
    carBooking = await bookCar(tripDetails.car)
    
    return {
      success: true,
      flightBooking,
      hotelBooking,
      carBooking
    }
  } catch (error) {
    // Compensating actions - rollback in reverse order
    if (carBooking) {
      await cancelCarBooking(carBooking.id)
    }
    if (hotelBooking) {
      await cancelHotelBooking(hotelBooking.id)
    }
    if (flightBooking) {
      await cancelFlightBooking(flightBooking.id)
    }
    
    throw error  // Re-throw after cleanup
  }
}
```

## Cancellation Steps

```typescript
async function cancelFlightBooking(bookingId: string) {
  "use step";
  
  try {
    await flightApi.cancel(bookingId)
  } catch (error) {
    // Log but don't fail - best effort cleanup
    await logCancellationError('flight', bookingId, error)
  }
}

async function cancelHotelBooking(bookingId: string) {
  "use step";
  
  try {
    await hotelApi.cancel(bookingId)
  } catch (error) {
    await logCancellationError('hotel', bookingId, error)
  }
}

async function cancelCarBooking(bookingId: string) {
  "use step";
  
  try {
    await carApi.cancel(bookingId)
  } catch (error) {
    await logCancellationError('car', bookingId, error)
  }
}
```

## Key Points

- Track successful operations so you know what to rollback
- Rollback in reverse order (LIFO)
- Make cancellation steps idempotent
- Consider "best effort" cleanup vs hard failure on rollback errors
- Log all rollback activity for debugging
