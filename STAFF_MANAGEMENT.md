# Staff Management

Admin -> Staff Management lets the restaurant owner create and manage staff accounts without editing code.

## Add a staff member
1. Sign in to `/staff` as an Admin.
2. Open **Staff Management**.
3. Select **Add Staff**.
4. Enter Name, Mobile, Email, Role, and Password.
5. Choose Kitchen or Rider.
6. Save.
7. Give the staff member the email and password you created.

The staff member uses the same `/staff` login page. Their role automatically opens the appropriate portal.

## Edit / password reset
Use **Edit** to change the name, phone, email, role, active status, or set a new password. Leaving the password field blank keeps the current password.

## Disable / enable
Use **Disable** to prevent a staff account from logging in. Use **Enable** to restore access.

Passwords are stored as bcrypt hashes, not plain text.

The seeded development accounts remain available for local testing:
- Admin: `admin@darshan.com` / `admin123`
- Kitchen: `chef@darshan.com` / `chef123`
- Rider: `rider@darshan.com` / `rider123`

Change these development credentials before real deployment.
