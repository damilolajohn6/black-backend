# User Management API Documentation

This document outlines the API endpoints for user management, including user creation, authentication, profile updates, and admin operations. All endpoints requiring authentication use a JWT token in the `Authorization` header.

## Base URL

```
http://localhost:8000/api/v2/user
```

## Authentication

Endpoints marked as requiring authentication need a JWT token in the `Authorization` header:

```
Authorization: Bearer <your_jwt_token>
```

Some endpoints require admin privileges, enforced by the `isAdmin` middleware.

## Endpoints

### 1. Create User

- **Endpoint**: `POST /create-user`
- **Description**: Creates a new user account with optional avatar upload and sends an OTP for email verification.
- **Body** (multipart/form-data):
  - `email` (string, required): User's email
  - `password` (string, required): Password (min 6 characters)
  - `fullname` (JSON string, required): Object with `firstName` (required), `lastName` (required), `middleName` (optional)
  - `username` (string, required): Username (3-30 characters, letters, numbers, or underscores)
  - `role` (string, optional): Role (`user`, `seller`, `instructor`, `serviceProvider`, `admin`; default: `user`)
  - `phone` (JSON string, optional): Object with `countryCode` (e.g., `+1`) and `number` (7-15 digits)
  - `avatar` (file, optional): Image file (max 5MB)
- **Authentication**: Not required
- **Response**:
  - Success: `201 Created` with a message to check email for OTP
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X POST http://localhost:8000/api/v2/user/create-user \
  -H "Content-Type: multipart/form-data" \
  -F "email=test@example.com" \
  -F "password=secure123" \
  -F "fullname={\"firstName\":\"John\",\"lastName\":\"Doe\"}" \
  -F "username=johndoe" \
  -F "role=user" \
  -F "phone={\"countryCode\":\"+1\",\"number\":\"1234567890\"}" \
  -F "avatar=@/path/to/avatar.jpg"
  ```

### 2. Resend OTP

- **Endpoint**: `POST /resend-otp`
- **Description**: Resends an OTP to a user's email for account verification.
- **Body**:
  - `email` (string, required): User's email
- **Authentication**: Not required
- **Response**:
  - Success: `200 OK` with a message confirming OTP sent
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X POST http://localhost:8000/api/v2/user/resend-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
  ```

### 3. Activate User

- **Endpoint**: `POST /activation`
- **Description**: Activates a user account using the OTP sent to their email.
- **Body**:
  - `email` (string, required): User's email
  - `otp` (string, required): OTP received via email
- **Authentication**: Not required
- **Response**:
  - Success: `201 Created` with a JWT token
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X POST http://localhost:8000/api/v2/user/activation \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "otp": "123456"}'
  ```

### 4. Login User

- **Endpoint**: `POST /login-user`
- **Description**: Authenticates a user and returns a JWT token.
- **Body**:
  - `email` (string, required): User's email
  - `password` (string, required): User's password
- **Authentication**: Not required
- **Response**:
  - Success: `201 Created` with a JWT token
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X POST http://localhost:8000/api/v2/user/login-user \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "secure123"}'
  ```

### 5. Forgot Password - Request OTP

- **Endpoint**: `POST /forgot-password`
- **Description**: Sends an OTP to the user's email for password reset.
- **Body**:
  - `email` (string, required): User's email
- **Authentication**: Not required
- **Response**:
  - Success: `200 OK` with a message confirming OTP sent
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X POST http://localhost:8000/api/v2/user/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
  ```

### 6. Reset Password

- **Endpoint**: `POST /reset-password`
- **Description**: Resets the user's password using the OTP.
- **Body**:
  - `email` (string, required): User's email
  - `otp` (string, required): OTP received via email
  - `newPassword` (string, required): New password (min 6 characters)
  - `confirmPassword` (string, required): Confirm new password
- **Authentication**: Not required
- **Response**:
  - Success: `200 OK` with a success message
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X POST http://localhost:8000/api/v2/user/reset-password \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "otp": "123456", "newPassword": "newpass123", "confirmPassword": "newpass123"}'
  ```

### 7. Load User

- **Endpoint**: `GET /getuser`
- **Description**: Retrieves the authenticated user's information.
- **Authentication**: Required (JWT token)
- **Response**:
  - Success: `200 OK` with user data
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/user/getuser \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

### 8. Log Out User

- **Endpoint**: `GET /logout`
- **Description**: Logs out the authenticated user by clearing the token cookie.
- **Authentication**: Required (JWT token)
- **Response**:
  - Success: `201 Created` with a success message
  - Error: `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/user/logout \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

### 9. Update User Info

- **Endpoint**: `PUT /update-user-info`
- **Description**: Updates the authenticated user's email, username, or phone number after password verification.
- **Body**:
  - `email` (string, optional): New email
  - `password` (string, required): Current password
  - `username` (string, optional): New username
  - `phoneNumber` (object, optional): Object with `countryCode` and `number`
- **Authentication**: Required (JWT token)
- **Response**:
  - Success: `201 Created` with updated user data
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/user/update-user-info \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "newemail@example.com", "password": "secure123", "username": "newusername", "phoneNumber": {"countryCode": "+1", "number": "9876543210"}}'
  ```

### 10. Update User Avatar

- **Endpoint**: `PUT /update-avatar`
- **Description**: Updates the authenticated user's avatar.
- **Body** (multipart/form-data):
  - `avatar` (file, required): New image file (max 5MB)
- **Authentication**: Required (JWT token)
- **Response**:
  - Success: `200 OK` with updated user data
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/user/update-avatar \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: multipart/form-data" \
  -F "avatar=@/path/to/new_avatar.jpg"
  ```

### 11. Update User Addresses

- **Endpoint**: `PUT /update-user-addresses`
- **Description**: Adds or updates an address for the authenticated user.
- **Body**:
  - `country` (string, optional): Country
  - `city` (string, optional): City
  - `address1` (string, optional): Primary address
  - `address2` (string, optional): Secondary address
  - `zipCode` (number, optional): Zip code
  - `addressType` (string, required): Address type (e.g., `home`, `work`)
  - `_id` (string, optional): Address ID for updating existing address
- **Authentication**: Required (JWT token)
- **Response**:
  - Success: `200 OK` with updated user data
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/user/update-user-addresses \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"country": "USA", "city": "New York", "address1": "123 Main St", "address2": "", "zipCode": 10001, "addressType": "home"}'
  ```

### 12. Delete User Address

- **Endpoint**: `DELETE /delete-user-address/:id`
- **Description**: Deletes a specific address from the authenticated user's address list.
- **Parameters**:
  - `id` (path): Address ID
- **Authentication**: Required (JWT token)
- **Response**:
  - Success: `200 OK` with updated user data
  - Error: `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X DELETE http://localhost:8000/api/v2/user/delete-user-address/<address_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

### 13. Update User Password

- **Endpoint**: `PUT /update-user-password`
- **Description**: Updates the authenticated user's password after verifying the old password.
- **Body**:
  - `oldPassword` (string, required): Current password
  - `newPassword` (string, required): New password (min 6 characters)
  - `confirmPassword` (string, required): Confirm new password
- **Authentication**: Required (JWT token)
- **Response**:
  - Success: `200 OK` with a success message
  - Error: `400 Bad Request` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/user/update-user-password \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"oldPassword": "secure123", "newPassword": "newpass123", "confirmPassword": "newpass123"}'
  ```

### 14. Find User Information

- **Endpoint**: `GET /user-info/:id`
- **Description**: Retrieves information for a specific user by ID.
- **Parameters**:
  - `id` (path): User ID
- **Authentication**: Not required
- **Response**:
  - Success: `200 OK` with user data
  - Error: `404 Not Found` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/user/user-info/<user_id> \
  -H "Content-Type: application/json"
  ```

### 15. Get All Users (Admin)

- **Endpoint**: `GET /admin-all-users`
- **Description**: Retrieves a list of all users, sorted by creation date (admin only).
- **Authentication**: Required (JWT token, admin role)
- **Response**:
  - Success: `201 Created` with a list of users
  - Error: `500 Internal Server Error` or `401 Unauthorized`
- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/user/admin-all-users \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

### 16. Delete User (Admin)

- **Endpoint**: `DELETE /delete-user/:id`
- **Description**: Deletes a user by ID and their associated avatar (admin only).
- **Parameters**:
  - `id` (path): User ID
- **Authentication**: Required (JWT token, admin role)
- **Response**:
  - Success: `201 Created` with a success message
  - Error: `404 Not Found` or `500 Internal Server Error`
- **Example curl**:

  ```bash
  curl -X DELETE http://localhost:8000/api/v2/user/delete-user/<user_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

## Notes

- Replace `<your_jwt_token>` with a valid JWT token obtained from `/login-user` or `/activation`.
- Replace `<user_id>` and `<address_id>` with valid MongoDB ObjectIDs.
- Ensure the server is running on `http://localhost:8000` or adjust the base URL accordingly.
- For endpoints with file uploads (e.g., `/create-user`, `/update-avatar`), use `multipart/form-data` and specify the file path for the `avatar` field. Replace `/path/to/avatar.jpg` with the actual path to an image file.
- The `/create-user` and `/update-user-info` endpoints expect `fullname` and `phone` as JSON strings when sent via `multipart/form-data`.
- Admin-only endpoints (`/admin-all-users`, `/delete-user`) require a user with the `admin` role.

## 684175dc852cc7f775c1b65f

