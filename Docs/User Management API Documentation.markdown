User API Documentation
This documentation outlines the User API, which handles user-related operations such as registration, authentication, profile management, and administrative tasks. The API is built with Express.js, MongoDB, and integrates with Cloudinary for avatar uploads and Socket.IO for real-time notifications.
Base URL
http://localhost:8000/api/v2/user

Authentication
Most endpoints require authentication via a JSON Web Token (JWT). Include the token in the Authorization header as Bearer <token>. Some endpoints require admin privileges.
Content Types

Request Body: application/json for JSON data, multipart/form-data for file uploads (e.g., avatar).
Response: application/json

Error Handling
Errors are returned with a JSON object containing success: false and an error message. Common HTTP status codes include:

200: Success
201: Resource created
400: Bad request
403: Forbidden
404: Resource not found
500: Server error

Endpoints
1. Create User
Register a new user with optional avatar upload and send an OTP for email verification.

Method: POST
Path: /create-user
Authentication: None
Request Body: multipart/form-data{
  "email": "string",
  "password": "string",
  "fullname": "{\"firstName\": \"string\", \"lastName\": \"string\"}",
  "username": "string",
  "role": "user|seller|instructor|serviceProvider|admin",
  "phone": "{\"countryCode\": \"string\", \"number\": \"string\"}",
  "avatar": "file" // Optional image file
}


Response:{
  "success": true,
  "message": "Please check your email (<email>) to activate your account with the OTP!"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/user/create-user" -F "email=test@example.com" -F "password=123456" -F "fullname={\"firstName\":\"John\",\"lastName\":\"Doe\"}" -F "username=johndoe" -F "role=user" -F "phone={\"countryCode\":\"+1\",\"number\":\"1234567890\"}" -F "avatar=@/path/to/avatar.jpg"



2. Resend OTP
Resend a verification OTP to the user's email.

Method: POST
Path: /resend-otp
Authentication: None
Request Body:{
  "email": "string"
}


Response:{
  "success": true,
  "message": "A new OTP has been sent to <email>."
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/user/resend-otp" -H "Content-Type: application/json" -d '{"email":"test@example.com"}'



3. Activate User
Activate a user account using the OTP sent to their email.

Method: POST
Path: /activation
Authentication: None
Request Body:{
  "email": "string",
  "otp": "string"
}


Response:{
  "success": true,
  "user": {},
  "token": "string"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/user/activation" -H "Content-Type: application/json" -d '{"email":"test@example.com","otp":"123456"}'



4. Login User
Authenticate a user and return a JWT token.

Method: POST
Path: /login-user
Authentication: None
Request Body:{
  "email": "string",
  "password": "string"
}


Response:{
  "success": true,
  "user": {},
  "token": "string"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/user/login-user" -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"123456"}'



5. Forgot Password
Request a password reset OTP.

Method: POST
Path: /forgot-password
Authentication: None
Request Body:{
  "email": "string"
}


Response:{
  "success": true,
  "message": "A password reset OTP has been sent to <email>."
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/user/forgot-password" -H "Content-Type: application/json" -d '{"email":"test@example.com"}'



6. Reset Password
Reset the user's password using the OTP.

Method: POST
Path: /reset-password
Authentication: None
Request Body:{
  "email": "string",
  "otp": "string",
  "newPassword": "string",
  "confirmPassword": "string"
}


Response:{
  "success": true,
  "message": "Password reset successfully"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/user/reset-password" -H "Content-Type: application/json" -d '{"email":"test@example.com","otp":"123456","newPassword":"newpass123","confirmPassword":"newpass123"}'



7. Load User
Retrieve the authenticated user's information.

Method: GET
Path: /getuser
Authentication: Required
Response:{
  "success": true,
  "user": {}
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/user/getuser" -H "Authorization: Bearer <your_token>"



8. Log Out User
Log out the authenticated user by clearing the token cookie.

Method: GET
Path: /logout
Authentication: None
Response:{
  "success": true,
  "message": "Log out successful!"
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/user/logout"



9. Update User Info
Update the authenticated user's email, username, or phone number.

Method: PUT
Path: /update-user-info
Authentication: Required
Request Body:{
  "email": "string",
  "password": "string",
  "username": "string",
  "phoneNumber": {"countryCode": "string", "number": "string"}
}


Response:{
  "success": true,
  "user": {}
}


cURL Example:curl -X PUT "http://localhost:8000/api/v2/user/update-user-info" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"email":"new@example.com","password":"123456","username":"newusername","phoneNumber":{"countryCode":"+1","number":"9876543210"}}'



10. Update User Avatar
Update the authenticated user's avatar.

Method: PUT
Path: /update-avatar
Authentication: Required
Request Body: multipart/form-data{
  "avatar": "file" // Image file
}


Response:{
  "success": true,
  "user": {}
}


cURL Example:curl -X PUT "http://localhost:8000/api/v2/user/update-avatar" -H "Authorization: Bearer <your_token>" -F "avatar=@/path/to/new_avatar.jpg"



11. Update User Addresses
Add or update an address for the authenticated user.

Method: PUT
Path: /update-user-addresses
Authentication: Required
Request Body:{
  "_id": "string", // Optional, for updating existing address
  "addressType": "string",
  "street": "string",
  "city": "string",
  "state": "string",
  "country": "string",
  "zipCode": "string"
}


Response:{
  "success": true,
  "user": {}
}


cURL Example:curl -X PUT "http://localhost:8000/api/v2/user/update-user-addresses" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"addressType":"Home","street":"123 Main St","city":"New York","state":"NY","country":"USA","zipCode":"10001"}'



12. Delete User Address
Delete an address for the authenticated user.

Method: DELETE
Path: /delete-user-address/:id
Authentication: Required
Parameters:
id: Address ID (path parameter)


Response:{
  "success": true,
  "user": {}
}


cURL Example:curl -X DELETE "http://localhost:8000/api/v2/user/delete-user-address/<address_id>" -H "Authorization: Bearer <your_token>"



13. Update User Password
Update the authenticated user's password.

Method: PUT
Path: /update-user-password
Authentication: Required
Request Body:{
  "oldPassword": "string",
  "newPassword": "string",
  "confirmPassword": "string"
}


Response:{
  "success": true,
  "message": "Password updated successfully!"
}


cURL Example:curl -X PUT "http://localhost:8000/api/v2/user/update-user-password" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"oldPassword":"123456","newPassword":"newpass123","confirmPassword":"newpass123"}'



14. Find User Information
Retrieve information for a specific user by ID.

Method: GET
Path: /user-info/:id
Authentication: None
Parameters:
id: User ID (path parameter)


Response:{
  "success": true,
  "user": {}
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/user/user-info/<user_id>"



15. Get All Users (Admin)
Retrieve all users, sorted by creation date (admin only).

Method: GET
Path: /admin-all-users
Authentication: Required (admin)
Response:{
  "success": true,
  "users": []
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/user/admin-all-users" -H "Authorization: Bearer <your_token>"



16. Delete User (Admin)
Delete a user and their associated avatar (admin only).

Method: DELETE
Path: /delete-user/:id
Authentication: Required (admin)
Parameters:
id: User ID (path parameter)


Response:{
  "success": true,
  "message": "User deleted successfully!"
}


cURL Example:curl -X DELETE "http://localhost:8000/api/v2/user/delete-user/<user_id>" -H "Authorization: Bearer <your_token>"



17. Report User
Report a user for review.

Method: POST
Path: /report-user/:id
Authentication: Required
Parameters:
id: User ID to report (path parameter)


Request Body:{
  "reason": "string"
}


Response:{
  "success": true,
  "message": "User reported successfully"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/user/report-user/<user_id>" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"reason":"Inappropriate behavior"}'



18. Block User
Block a user to prevent interactions.

Method: POST
Path: /block-user/:id
Authentication: Required
Parameters:
id: User ID to block (path parameter)


Response:{
  "success": true,
  "message": "Blocked <username>"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/user/block-user/<user_id>" -H "Authorization: Bearer <your_token>"



19. Unblock User
Unblock a previously blocked user.

Method: POST
Path: /unblock-user/:id
Authentication: Required
Parameters:
id: User ID to unblock (path parameter)


Response:{
  "success": true,
  "message": "Unblocked <username>"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/user/unblock-user/<user_id>" -H "Authorization: Bearer <your_token>"



20. Get Blocked Users
Retrieve the list of users blocked by the authenticated user.

Method: GET
Path: /blocked-users
Authentication: Required
Response:{
  "success": true,
  "blockedUsers": []
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/user/blocked-users" -H "Authorization: Bearer <your_token>"



Real-Time Events (Socket.IO)
The API uses Socket.IO for real-time notifications. Key events include:

userBlocked: Emitted when a user is blocked.
userUnblocked: Emitted when a user is unblocked.

Notes

Replace <your_token> with a valid JWT token.
Replace <user_id> and <address_id> with valid IDs.
Avatar uploads must be image files (max 5MB).
Ensure environment variables for Cloudinary (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are configured.
The fullname and phone fields in /create-user must be JSON strings.
OTPs expire after 10 minutes.
Passwords must be at least 6 characters.
Usernames must be 3-30 characters, containing only letters, numbers, or underscores.

