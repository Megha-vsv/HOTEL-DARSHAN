import { Bell, Home, IndianRupee, Package, User } from 'lucide-react';

// The five places a rider can be. Kept out of the component so the navigation
// and the shell agree on them without one importing the other's internals, and
// so this file is a plain list rather than a component module.
export const RIDER_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'orders', label: 'Orders', icon: Package },
  { id: 'earnings', label: 'Earnings', icon: IndianRupee },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'profile', label: 'Profile', icon: User }
];

export default RIDER_TABS;
