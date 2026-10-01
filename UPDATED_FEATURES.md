# Updated Hotel Darshan Version

Implemented fixes and additions:

1. Admin menu edit/add save now reports backend errors and refreshes persisted menu data after save.
2. Admin categories now support add, edit and delete.
3. Admin offers/coupons now support add, edit and delete, with active/inactive state.
4. Coupon validation now respects expiry and usage limits.
5. Admin Settings now has stronger save/error handling plus restaurant name/phone/address fields.
6. Settings writes are restricted to known restaurant configuration keys.
7. Every customer created through OTP registration is stored in `users` with role `customer` and appears in Admin > Customers.
8. Customer directory shows registration date, order count, lifetime spend and last order.
9. Staff accounts are role-based and the backend ensures the default development Admin/Kitchen/Rider accounts exist.
10. Staff login has one consistent Hotel Darshan theme and shows the development credentials.
11. Kitchen UI includes a dedicated Kitchen Menu Availability section for quick Available/Unavailable control.
12. Kitchen/Rider/Admin order status permissions remain role-restricted on the backend.

Run:

- `npm install` in the project root if needed.
- `npm --prefix server install`
- `npm --prefix client install`
- Start server: `npm --prefix server start`
- Start client: `npm --prefix client dev`

## Staff Management Update
- Admin now has a Staff Management section.
- Admin can add Kitchen and Rider accounts without changing source code.
- Admin can edit staff name, mobile, email, role, active status, and optionally reset password.
- Admin can disable/enable staff accounts.
- Disabled staff accounts are rejected by the staff login endpoint.
- Staff credentials are stored as bcrypt password hashes in the users table.
- Staff Management is available at Admin -> Staff Management.
