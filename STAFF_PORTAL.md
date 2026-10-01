# Hotel Darshan Staff Portals

The customer application and staff operations are separated.

## Customer app
- `http://localhost:5173/`
- OTP registration/login
- Location permission and delivery address
- Menu, cart, checkout and order tracking
- No heart/favorites button
- No admin/kitchen/rider switcher

## Staff portal
- `http://localhost:5173/staff`
- Staff email/password login
- After login, the user is sent to the correct role portal.

### Development accounts
These are seeded only for local development/testing:

- Admin: `admin@darshan.com` / `admin123`
- Kitchen: `chef@darshan.com` / `chef123`
- Rider: `rider@darshan.com` / `rider123`

Change/remove these credentials before production deployment.

## Role URLs
- `/staff/admin` — owner/admin analytics, orders, menu, kitchen, payments, customers, reviews and settings
- `/staff/kitchen` — kitchen order queue and preparation workflow
- `/staff/rider` — delivery orders, navigation and browser/device GPS broadcasting

The backend enforces the roles as well, so changing the URL alone does not grant permissions.

## Menu data
The customer UI uses the original Hotel Darshan food images from `client/public/FoodImages`.
The backend preserves runtime availability/stock/special/popular changes. Legacy seeded menu rows from the previous dataset are cleaned up by ID so the Hotel Special category starts with the three master items: Special Darshan, Gujarati Thali and Punjabi Thali.
