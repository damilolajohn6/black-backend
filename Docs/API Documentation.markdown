E-Commerce Platform API Documentation
This documentation provides details for integrating with the backend API of an e-commerce platform that supports shops, products, orders, messaging, and course-related functionalities. The API is built using Express.js and MongoDB, with Cloudinary for media storage and Socket.IO for real-time messaging. It is designed to support mobile app development, with endpoints for user authentication, shop management, product operations, order processing, and real-time communication.
Base URL
All endpoints are relative to:http://localhost:8000/api/v2
Authentication

JWT Tokens: Most endpoints require a Bearer token in the Authorization header or a seller_token cookie for shop-related operations.
Example:  Authorization: Bearer <JWT_TOKEN>


Roles: Endpoints are protected by middleware (isAuthenticated, isSeller, isInstructor) to restrict access based on user roles (Seller, Admin, Instructor).
Obtaining a Token: Tokens are returned upon successful login (/user/login-shop) or shop creation/activation (/shop/create-shop, /shop/activation).

Content Type

Request Bodies: Use Content-Type: application/json unless specified otherwise (e.g., file uploads use multipart/form-data).
Response Format: JSON with success (boolean) and relevant data or error message.

Error Responses

Format:{
  "success": false,
  "error": "Error message"
}


Common Status Codes:
200: Success
201: Resource created
400: Bad request
401: Unauthorized
403: Forbidden
404: Not found
500: Server error



Endpoints
1. Shop Management (/shop)
Create Shop

Method: POST
Path: /shop/create-shop
Description: Creates a new shop account and sends an OTP for verification.
Request Body:{
  "fullname": {
    "firstName": "John",
    "lastName": "Doe"
  },
  "name": "John's Store",
  "email": "john@example.com",
  "password": "securepassword",
  "address": "123 Main St",
  "zipCode": "12345",
  "phone": {
    "countryCode": "+1",
    "number": "1234567890"
  },
  "avatar": {
    "public_id": "",
    "url": ""
  }
}


Response:{
  "success": true,
  "message": "Please check your email (john@example.com) to activate your shop account with the OTP!"
}


cURL:curl -X POST http://localhost:8000/api/v2/shop/create-shop \
-H "Content-Type: application/json" \
-d '{
  "fullname": {"firstName": "John", "lastName": "Doe"},
  "name": "John'\''s Store",
  "email": "john@example.com",
  "password": "securepassword",
  "address": "123 Main St",
  "zipCode": "12345",
  "phone": {"countryCode": "+1", "number": "1234567890"},
  "avatar": {"public_id": "", "url": ""}
}'



Activate Shop

Method: POST
Path: /shop/activation
Description: Activates a shop using the OTP sent to the email.
Request Body:{
  "email": "john@example.com",
  "otp": "123456"
}


Response:{
  "success": true,
  "seller": { /* Shop details */ },
  "token": "JWT_TOKEN"
}


cURL:curl -X POST http://localhost:8000/api/v2/shop/activation \
-H "Content-Type: application/json" \
-d '{"email": "john@example.com", "otp": "123456"}'



Login Shop

Method: POST
Path: /shop/login-shop
Description: Logs in a shop and returns a JWT token.
Request Body:{
  "email": "john@example.com",
  "password": "securepassword"
}


Response:{
  "success": true,
  "seller": { /* Shop details */ },
  "token": "JWT_TOKEN"
}


cURL:curl -X POST http://localhost:8000/api/v2/shop/login-shop \
-H "Content-Type: application/json" \
-d '{"email": "john@example.com", "password": "securepassword"}'



Get Shop Info

Method: GET
Path: /shop/get-shop-info/:id
Description: Retrieves public information about a shop by ID.
Parameters:
id: Shop ID (path parameter)


Response:{
  "success": true,
  "shop": { /* Shop details */ }
}


cURL:curl -X GET http://localhost:8000/api/v2/shop/get-shop-info/507f1f77bcf86cd799439011



Update Shop Avatar

Method: PUT
Path: /shop/update-shop-avatar
Description: Updates the shop’s profile picture (requires authentication).
Headers:
Authorization: Bearer <JWT_TOKEN>


Request Body:{
  "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQE..."
}


Response:{
  "success": true,
  "seller": { /* Updated shop details */ }
}


cURL:curl -X PUT http://localhost:8000/api/v2/shop/update-shop-avatar \
-H "Authorization: Bearer <JWT_TOKEN>" \
-H "Content-Type: application/json" \
-d '{"avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQE..."}'



2. Product Management (/product)
Create Product

Method: POST
Path: /product/create-product
Description: Creates a new product for a shop (requires seller authentication).
Headers:
Authorization: Bearer <JWT_TOKEN>


Request Body:{
  "shopId": "507f1f77bcf86cd799439011",
  "name": "T-Shirt",
  "description": "Comfortable cotton t-shirt",
  "category": "Clothing",
  "price": 19.99,
  "stock": 100,
  "images": [
    {
      "public_id": "",
      "url": "https://example.com/image.jpg"
    }
  ]
}


Response:{
  "success": true,
  "product": { /* Product details */ }
}


cURL:curl -X POST http://localhost:8000/api/v2/product/create-product \
-H "Authorization: Bearer <JWT_TOKEN>" \
-H "Content-Type: application/json" \
-d '{
  "shopId": "507f1f77bcf86cd799439011",
  "name": "T-Shirt",
  "description": "Comfortable cotton t-shirt",
  "category": "Clothing",
  "price": 19.99,
  "stock": 100,
  "images": [{"public_id": "", "url": "https://example.com/image.jpg"}]
}'



Get All Products of a Shop

Method: GET
Path: /product/get-all-products-shop/:id
Description: Retrieves all products for a specific shop.
Parameters:
id: Shop ID (path parameter)


Response:{
  "success": true,
  "products": [ /* Array of products */ ]
}


cURL:curl -X GET http://localhost:8000/api/v2/product/get-all-products-shop/507f1f77bcf86cd799439011



Delete Product

Method: DELETE
Path: /product/delete-shop-product/:id
Description: Deletes a product (requires seller authentication).
Headers:
Authorization: Bearer <JWT_TOKEN>


Parameters:
id: Product ID (path parameter)


Response:{
  "success": true,
  "message": "Product deleted successfully"
}


cURL:curl -X DELETE http://localhost:8000/api/v2/product/delete-shop-product/507f1f77bcf86cd799439012 \
-H "Authorization: Bearer <JWT_TOKEN>"



3. Order Management (/order)
Create Order

Method: POST
Path: /order/create-order
Description: Creates a new order for products or courses (requires user authentication).
Headers:
Authorization: Bearer <JWT_TOKEN>


Request Body:{
  "cart": [
    {
      "itemType": "Product",
      "itemId": "507f1f77bcf86cd799439012",
      "shopId": "507f1f77bcf86cd799439011",
      "quantity": 2,
      "name": "T-Shirt",
      "price": 19.99
    }
  ],
  "shippingAddress": {
    "address": "123 Main St",
    "city": "Anytown",
    "country": "USA",
    "zipCode": "12345"
  },
  "totalAmount": 39.98,
  "paymentStatus": "Paid"
}


Response:{
  "success": true,
  "orders": [ /* Array of created orders */ ]
}


cURL:curl -X POST http://localhost:8000/api/v2/order/create-order \
-H "Authorization: Bearer <JWT_TOKEN>" \
-H "Content-Type: application/json" \
-d '{
  "cart": [
    {
      "itemType": "Product",
      "itemId": "507f1f77bcf86cd799439012",
      "shopId": "507f1f77bcf86cd799439011",
      "quantity": 2,
      "name": "T-Shirt",
      "price": 19.99
    }
  ],
  "shippingAddress": {
    "address": "123 Main St",
    "city": "Anytown",
    "country": "USA",
    "zipCode": "12345"
  },
  "totalAmount": 39.98,
  "paymentStatus": "Paid"
}'



Get All Orders of User

Method: GET
Path: /order/get-all-orders/:userId
Description: Retrieves all orders for a specific user (requires user authentication).
Headers:
Authorization: Bearer <JWT_TOKEN>


Parameters:
userId: User ID (path parameter)


Response:{
  "success": true,
  "orders": [ /* Array of orders */ ]
}


cURL:curl -X GET http://localhost:8000/api/v2/order/get-all-orders/507f1f77bcf86cd799439013 \
-H "Authorization: Bearer <JWT_TOKEN>"



Request Refund

Method: PUT
Path: /order/order-refund/:id
Description: Requests a refund for an order (requires user authentication).
Headers:
Authorization: Bearer <JWT_TOKEN>


Parameters:
id: Order ID (path parameter)


Request Body:{
  "status": "Refunded",
  "reason": "Product defective"
}


Response:{
  "success": true,
  "order": { /* Updated order */ },
  "message": "Order refund request submitted successfully"
}


cURL:curl -X PUT http://localhost:8000/api/v2/order/order-refund/507f1f77bcf86cd799439014 \
-H "Authorization: Bearer <JWT_TOKEN>" \
-H "Content-Type: application/json" \
-d '{"status": "Refunded", "reason": "Product defective"}'



4. Messaging (/conversation, /message)
Send Message to Shop

Method: POST
Path: /shop/send-message-to-shop/:shopId
Description: Sends a message from a user to a shop (requires user authentication).
Headers:
Authorization: Bearer <JWT_TOKEN>


Parameters:
shopId: Shop ID (path parameter)


Request Body:{
  "content": "Hello, is this product available?",
  "media": [
    {
      "type": "image",
      "data": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQE..."
    }
  ]
}


Response:{
  "success": true,
  "message": { /* Message details */ }
}


cURL:curl -X POST http://localhost:8000/api/v2/shop/send-message-to-shop/507f1f77bcf86cd799439011 \
-H "Authorization: Bearer <JWT_TOKEN>" \
-H "Content-Type: application/json" \
-d '{"content": "Hello, is this product available?", "media": [{"type": "image", "data": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQE..."}]}'



Get Conversations

Method: GET
Path: /shop/get-conversations
Description: Retrieves all conversations for a shop (requires seller authentication).
Headers:
Authorization: Bearer <JWT_TOKEN>


Query Parameters:
page: Page number (default: 1)
limit: Items per page (default: 20)


Response:{
  "success": true,
  "conversations": [ /* Array of conversations */ ],
  "totalConversations": 10,
  "page": 1,
  "totalPages": 1
}


cURL:curl -X GET http://localhost:8000/api/v2/shop/get-conversations?page=1&limit=20 \
-H "Authorization: Bearer <JWT_TOKEN>"



Real-Time Messaging with Socket.IO

Description: The API supports real-time messaging using Socket.IO for user-shop communication.
Connection URL: ws://localhost:8000
Events:
newMessage: Received when a new message is sent.
messageSent: Confirms a message was sent successfully.
messageRead: Notifies when a message is marked as read.
messageDeleted: Notifies when a message is deleted.


Mobile Integration:
Use a Socket.IO client library (e.g., socket.io-client for React Native or Flutter).
Authenticate the socket connection with the JWT token:const socket = io('http://localhost:8000', {
  auth: { token: 'Bearer <JWT_TOKEN>' }
});
socket.on('newMessage', (message) => {
  console.log('New message:', message);
});





Environment Variables
Ensure the mobile app interacts with a backend configured with the following environment variables (in config/.env):

PORT: Server port (default: 8000)
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET: For media uploads
MONGODB_URI: MongoDB connection string
JWT_SECRET: For token generation

Testing with Postman

Import cURL Commands: Copy the provided cURL commands into Postman’s “Import” feature or use them directly in a terminal.
Authentication: Set the Authorization header with the JWT token obtained from /shop/login-shop or /shop/activation.
Environment Setup:
Create a Postman environment with variables:
BASE_URL: http://localhost:8000/api/v2
JWT_TOKEN: Store the token after login


Update cURL commands to use {{BASE_URL}} and {{JWT_TOKEN}}.



Notes for Mobile Developers

Error Handling: Always handle HTTP status codes (400, 401, 403, etc.) and display user-friendly error messages based on the error field in responses.
Media Uploads: Use base64-encoded images/videos for media uploads or integrate with Cloudinary’s upload API directly for better performance.
Real-Time Features: Implement Socket.IO for real-time messaging to provide a seamless chat experience.
Pagination: Use page and limit query parameters for endpoints like /shop/get-conversations to optimize data loading.
Cross-Origin Requests: The API supports CORS for specific origins (http://localhost:3000, https://example.com, https://blacknsell.vercel.app). Ensure your mobile app’s requests align with these origins or configure the backend to allow additional origins.
Rate Limiting: Messaging endpoints (/shop/send-message-to-shop, /shop/reply-to-user) have a rate limit of 50 messages per 15 minutes. Handle the 429 Too Many Requests response gracefully.

Example Postman Collection
To facilitate testing, you can create a Postman collection with the following structure:

Shop Management
Create Shop
Activate Shop
Login Shop
Get Shop Info


Product Management
Create Product
Get All Products of Shop
Delete Product


Order Management
Create Order
Get All Orders of User
Request Refund


Messaging
Send Message to Shop
Get Conversations



Use the cURL commands provided above to populate the collection.