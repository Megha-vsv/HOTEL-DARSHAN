import React from 'react';
import RiderApp from './rider/RiderApp';

/**
 * Entry point for the rider surface.
 *
 * Kept as a component of its own so `StaffPortal` keeps importing the same name
 * it always has, and so the app is mounted in exactly one place.
 */
export default function RiderView() {
  return <RiderApp />;
}
