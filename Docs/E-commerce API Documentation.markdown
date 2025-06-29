# E-commerce API Documentation

This document outlines the API endpoints for managing products and orders in the marketplace  platform of the project, including product creation, updates, reviews, order processing, and statistics. It also includes details about the `Product`, `Order`, and `Shop` schemas for context. Endpoints requiring authentication use a JWT token in the `Authorization` header, and some require specific roles (e.g., seller, instructor, admin).

## Base URL

```
http://localhost:8000/api/v2
```

## Authentication

Endpoints marked as requiring authentication need a JWT token in the `Authorization` header:

```
Authorization: Bearer <your_jwt_token>
```

### Product Schema

- **name** (String, required): Product name (5-100 characters).
- **description** (String, required): Product description.
- **price** (Number, required): Product price (&gt; 0).
- **stock** (Number, required): Available stock (&gt;= 0).
- **images** (Array, required): Array of image objects with `public_id` (optional) and `url` (required).
- **category** (String, required): Category (`electronics`, `clothing`, `home`, `books`, `toys`, `food`, `digital`, `other`).
- **subCategory** (String): Subcategory.
- **tags** (Array): Array of tags.
- **priceDiscount** (Number): Discount price (must be less than `price`).
- **isMadeInCanada** (Boolean): Whether the product is made in Canada (default: `false`).
- **canadianCertification** (String): Canadian certification details.
- **variations** (Array): Array of variation objects (e.g., `name`, `options`, `price`, `stock`, `images`).
- **shipping** (Object): Shipping details (`weight`, `dimensions`, `isFreeShipping`, `cost`).
- **shop** (ObjectId, required): Reference to the `Shop` model.
- **seller** (ObjectId, required): Reference to the `Shop` model (seller).
- **reviews** (Array): Array of review objects (`user`, `name`, `rating`, `comment`, `createdAt`).
- **ratingsAverage** (Number): Average rating (0-5).
- **ratingsQuantity** (Number): Number of reviews.
- **status** (String): Product status (`draft`, `active`, `publish`, `archived`, `sold`; default: `active`).

### Order Schema

- **customer** (ObjectId, required): Reference to the `User` model.
- **shop** (ObjectId): Reference to the `Shop` model (for product orders).
- **instructor** (ObjectId): Reference to the `Instructor` model (for course orders).
- **items** (Array, required): Array of items (`itemType`: `Product` or `Course`, `itemId`, `name`, `quantity`, `price`).
- **totalAmount** (Number, required): Total order amount (&gt;= 0).
- **status** (String): Order status (`Pending`, `Confirmed`, `Shipped`, `Delivered`, `Cancelled`, `Refunded`; default: `Pending`).
- **statusHistory** (Array): History of status changes (`status`, `updatedAt`, `reason`).
- **paymentStatus** (String): Payment status (`Pending`, `Paid`, `Failed`, `Refunded`; default: `Pending`).
- **shippingAddress** (Object): Shipping address (`address`, `city`, `zipCode`, `country`) for physical products.
- **createdAt** (Date): Order creation date.
- **updatedAt** (Date): Last update date.

### Shop Schema

- **fullname** (Object, required): Seller's full name (`firstName`, `lastName`, `middleName`).
- **name** (String, required): Shop name (max 100 characters).
- **email** (String, required): Shop email (valid email format).
- **password** (String, required): Hashed password (min 6 characters).
- **description** (String): Shop description (max 500 characters).
- **address** (String, required): Shop address.
- **phoneNumber** (Object): Phone number (`countryCode`, `number`).
- **role** (String): Role (`Seller`, `Admin`; default: `Seller`).
- **avatar** (Object): Avatar image (`public_id`, `url`).
- **approvalStatus** (Object): Seller approval status (`isSellerApproved`, `approvalReason`, `approvedAt`).
- **zipCode** (String, required): Shop zip code.
- **withdrawMethod** (Object): Withdrawal method (`type`: `BankTransfer`, `PayPal`, `Other`, `details`).
- **availableBalance** (Number): Available balance (&gt;= 0).
- **pendingBalance** (Number): Pending balance (&gt;= 0).
- **transactions** (Array): Transaction history (`amount`, `type`, `status`, `createdAt`, `metadata`).
- **isVerified** (Boolean): Whether the shop is verified (default: `false`).

## Endpoints

### Product Endpoints

#### 1. Create Product

- **Endpoint**: `POST /product/create-product`

- **Description**: Creates a new product for a seller's shop.

- **Body**:

  - `shopId` (string, required): Shop ID (MongoDB ObjectId).
  - `name` (string, required): Product name.
  - `description` (string, required): Product description.
  - `category` (string, required): Product category.
  - `price` (number, required): Product price.
  - `stock` (number, required): Product stock.
  - `images` (array, required): Array of image objects (`public_id`, `url`).
  - `priceDiscount` (number, optional): Discount price.
  - `subCategory` (string, optional): Subcategory.
  - `tags` (array, optional): Array of tags.
  - `shipping` (object, optional): Shipping details.
  - `variations` (array, optional): Product variations.
  - `isMadeInCanada` (boolean, optional): Made in Canada flag.
  - `canadianCertification` (string, optional): Certification details.

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `201 Created` with the created product.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X POST http://localhost:8000/api/v2/product/create-product \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "shopId": "<shop_id>",
    "name": "Wireless Headphones",
    "description": "High-quality wireless headphones",
    "category": "electronics",
    "price": 99.99,
    "stock": 50,
    "images": [{"url": "https://example.com/image.jpg"}],
    "priceDiscount": 79.99,
    "subCategory": "audio",
    "tags": ["wireless", "headphones"],
    "shipping": {"weight": 0.5, "isFreeShipping": true},
    "isMadeInCanada": false
  }'
  ```

#### 2. Update Product

- **Endpoint**: `PUT /product/update-product/:id`

- **Description**: Updates an existing product owned by the seller.

- **Parameters**:

  - `id` (path): Product ID (MongoDB ObjectId).

- **Body**: Same as `create-product`.

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `200 OK` with the updated product.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/product/update-product/<product_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Wireless Headphones",
    "description": "Updated high-quality wireless headphones",
    "category": "electronics",
    "price": 109.99,
    "stock": 45,
    "images": [{"url": "https://example.com/new-image.jpg"}]
  }'
  ```

#### 3. Get Single Product

- **Endpoint**: `GET /product/get-product/:id`

- **Description**: Retrieves a single product owned by the seller.

- **Parameters**:

  - `id` (path): Product ID.

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `200 OK` with the product.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/product/get-product/<product_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

#### 4. Delete Image from Cloudinary

- **Endpoint**: `POST /product/delete-image`

- **Description**: Deletes an image from Cloudinary using its public ID.

- **Body**:

  - `public_id` (string, required): Cloudinary public ID of the image.

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `200 OK` with a success message.
  - Error: `400 Bad Request`, `401 Unauthorized`, `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X POST http://localhost:8000/api/v2/product/delete-image \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"public_id": "avatars/sample_image_id"}'
  ```

#### 5. Get All Products of a Shop

- **Endpoint**: `GET /product/get-all-products-shop/:id`

- **Description**: Retrieves all products for a specific shop.

- **Parameters**:

  - `id` (path): Shop ID.

- **Authentication**: Not required.

- **Response**:

  - Success: `200 OK` with a list of products.
  - Error: `400 Bad Request` or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/product/get-all-products-shop/<shop_id> \
  -H "Content-Type: application/json"
  ```

#### 6. Delete Product of a Shop

- **Endpoint**: `DELETE /product/delete-shop-product/:id`

- **Description**: Deletes a product owned by the seller, including its Cloudinary images.

- **Parameters**:

  - `id` (path): Product ID.

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `200 OK` with a success message.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X DELETE http://localhost:8000/api/v2/product/delete-shop-product/<product_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

#### 7. Get All Products

- **Endpoint**: `GET /product/get-all-products`

- **Description**: Retrieves all products, sorted by creation date.

- **Authentication**: Not required.

- **Response**:

  - Success: `200 OK` with a list of products.
  - Error: `400 Bad Request` or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/product/get-all-products \
  -H "Content-Type: application/json"
  ```

#### 8. Create or Update Product Review

- **Endpoint**: `PUT /product/create-new-review`

- **Description**: Creates or updates a review for a product by a user who ordered it.

- **Body**:

  - `rating` (number, required): Rating (1-5).
  - `comment` (string, required): Review comment.
  - `productId` (string, required): Product ID.
  - `orderId` (string, required): Order ID.

- **Authentication**: Required (JWT token, authenticated user).

- **Response**:

  - Success: `200 OK` with a success message.
  - Error: `400 Bad Request`, `401 Unauthorized`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/product/create-new-review \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 5,
    "comment": "Great product!",
    "productId": "<product_id>",
    "orderId": "<order_id>"
  }'
  ```

#### 9. Get All Products (Admin)

- **Endpoint**: `GET /product/admin-all-products`

- **Description**: Retrieves all products for admin users, sorted by creation date.

- **Authentication**: Required (JWT token, admin role).

- **Response**:

  - Success: `200 OK` with a list of products.
  - Error: `401 Unauthorized`, `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/product/admin-all-products \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

### Order Endpoints

#### 10. Create New Order

- **Endpoint**: `POST /order/create-order`

- **Description**: Creates a new order for products or courses, handling shop and instructor transactions.

- **Body**:

  - `cart` (array, required): Array of items (`itemType`: `Product` or `Course`, `itemId`, `shopId` or `instructorId`, `quantity`).
  - `shippingAddress` (object): Required for physical products (`address`, `city`, `zipCode`, `country`).
  - `totalAmount` (number, required): Total order amount.
  - `paymentStatus` (string, optional): Payment status (`Pending` or `Paid`; default: `Paid`).

- **Authentication**: Required (JWT token, authenticated user).

- **Response**:

  - Success: `201 Created` with the created orders.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X POST http://localhost:8000/api/v2/order/create-order \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "cart": [
      {
        "itemType": "Product",
        "itemId": "<product_id>",
        "shopId": "<shop_id>",
        "quantity": 2
      }
    ],
    "shippingAddress": {
      "address": "123 Main St",
      "city": "New York",
      "zipCode": "10001",
      "country": "USA"
    },
    "totalAmount": 199.98,
    "paymentStatus": "Paid"
  }'
  ```

#### 11. Get Single Order (Seller)

- **Endpoint**: `GET /order/get-single-order/:id`

- **Description**: Retrieves a single order for a seller.

- **Parameters**:

  - `id` (path): Order ID.

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `200 OK` with the order.
  - Error: `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/order/get-single-order/<order_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

#### 12. Get All Orders of User

- **Endpoint**: `GET /order/get-all-orders/:userId`

- **Description**: Retrieves all orders for a specific user (user or admin access).

- **Parameters**:

  - `userId` (path): User ID.

- **Authentication**: Required (JWT token, authenticated user or admin).

- **Response**:

  - Success: `200 OK` with a list of orders.
  - Error: `401 Unauthorized`, `403 Forbidden`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/order/get-all-orders/<user_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

#### 13. Get All Orders of Seller

- **Endpoint**: `GET /order/get-seller-all-orders/:shopId`

- **Description**: Retrieves all orders for a seller's shop, with optional filtering.

- **Parameters**:

  - `shopId` (path): Shop ID.

- **Query Parameters**:

  - `status` (string, optional): Filter by status.
  - `page` (number, optional): Page number (default: 1).
  - `limit` (number, optional): Items per page (default: 10).
  - `startDate` (string, optional): Start date (ISO format).
  - `endDate` (string, optional): End date (ISO format).

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `200 OK` with orders, total count, and pagination info.
  - Error: `401 Unauthorized`, `403 Forbidden`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/order/get-seller-all-orders/<shop_id>?status=Pending&page=1&limit=10 \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

#### 14. Get All Orders of Instructor

- **Endpoint**: `GET /order/get-instructor-all-orders/:instructorId`

- **Description**: Retrieves all course orders for an instructor, with optional filtering.

- **Parameters**:

  - `instructorId` (path): Instructor ID.

- **Query Parameters**: Same as `get-seller-all-orders`.

- **Authentication**: Required (JWT token, instructor role).

- **Response**:

  - Success: `200 OK` with orders, total count, and pagination info.
  - Error: `401 Unauthorized`, `403 Forbidden`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/order/get-instructor-all-orders/<instructor_id>?status=Confirmed \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

#### 15. Update Order Status (Seller)

- **Endpoint**: `PUT /order/update-order-status/:id`

- **Description**: Updates the status of a seller's order (e.g., `Pending` to `Confirmed`).

- **Parameters**:

  - `id` (path): Order ID.

- **Body**:

  - `status` (string, required): New status (`Confirmed`, `Shipped`, `Delivered`, `Cancelled`, `Refunded`).
  - `reason` (string, optional): Reason for status change.

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `200 OK` with the updated order.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/order/update-order-status/<order_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "Shipped", "reason": "Order dispatched"}'
  ```

#### 16. Update Course Order Status (Instructor)

- **Endpoint**: `PUT /order/update-course-order-status/:id`

- **Description**: Updates the status of a course order (e.g., `Confirmed`, `Refunded`, `Cancelled`).

- **Parameters**:

  - `id` (path): Order ID.

- **Body**:

  - `status` (string, required): New status.
  - `reason` (string, optional): Reason for status change.

- **Authentication**: Required (JWT token, instructor role).

- **Response**:

  - Success: `200 OK` with the updated order.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/order/update-course-order-status/<order_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "Confirmed", "reason": "Course access granted"}'
  ```

#### 17. Request Refund (User)

- **Endpoint**: `PUT /order/order-refund/:id`

- **Description**: Submits a refund request for an order by the customer.

- **Parameters**:

  - `id` (path): Order ID.

- **Body**:

  - `status` (string, required): Must be `Refunded`.
  - `reason` (string, required): Refund reason.

- **Authentication**: Required (JWT token, authenticated user).

- **Response**:

  - Success: `200 OK` with the updated order and a success message.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/order/order-refund/<order_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "Refunded", "reason": "Product defective"}'
  ```

#### 18. Approve Refund (Seller or Instructor)

- **Endpoint**: `PUT /order/order-refund-success/:id`

- **Description**: Approves a refund request, updating stock or enrollments and balances.

- **Parameters**:

  - `id` (path): Order ID.

- **Body**:

  - `status` (string, required): Must be `Refunded`.
  - `reason` (string, optional): Approval reason.

- **Authentication**: Required (JWT token, seller or instructor role).

- **Response**:

  - Success: `200 OK` with a success message.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X PUT http://localhost:8000/api/v2/order/order-refund-success/<order_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "Refunded", "reason": "Refund approved"}'
  ```

#### 19. Delete Order (Seller)

- **Endpoint**: `DELETE /order/delete-order/:id`

- **Description**: Deletes a `Pending` or `Cancelled` order owned by the seller.

- **Parameters**:

  - `id` (path): Order ID.

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `200 OK` with a success message.
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X DELETE http://localhost:8000/api/v2/order/delete-order/<order_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

#### 20. Get All Orders (Admin)

- **Endpoint**: `GET /order/admin-all-orders`

- **Description**: Retrieves all orders for admin users, with optional filtering.

- **Query Parameters**:

  - `status` (string, optional): Filter by status.
  - `page` (number, optional): Page number (default: 1).
  - `limit` (number, optional): Items per page (default: 10).

- **Authentication**: Required (JWT token, admin role).

- **Response**:

  - Success: `200 OK` with orders, total count, and pagination info.
  - Error: `401 Unauthorized` or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/order/admin-all-orders?status=Delivered&page=1&limit=10 \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

#### 21. Get Shop Statistics

- **Endpoint**: `GET /order/shop/stats/:shopId`

- **Description**: Retrieves statistics for a seller's shop (e.g., total sales, pending orders).

- **Parameters**:

  - `shopId` (path): Shop ID.

- **Authentication**: Required (JWT token, seller role).

- **Response**:

  - Success: `200 OK` with statistics (`totalSales`, `pendingOrders`, `totalOrders`, `recentOrders`).
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/order/shop/stats/<shop_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

#### 22. Get Instructor Statistics

- **Endpoint**: `GET /order/instructor/stats/:instructorId`

- **Description**: Retrieves statistics for an instructor (e.g., total sales, enrollments).

- **Parameters**:

  - `instructorId` (path): Instructor ID.

- **Authentication**: Required (JWT token, instructor role).

- **Response**:

  - Success: `200 OK` with statistics (`totalSales`, `totalOrders`, `recentOrders`, `totalEnrollments`, `completedEnrollments`).
  - Error: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, or `500 Internal Server Error`.

- **Example curl**:

  ```bash
  curl -X GET http://localhost:8000/api/v2/order/instructor/stats/<instructor_id> \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json"
  ```

## Notes

- Replace `<your_jwt_token>` with a valid JWT token obtained from user authentication (e.g., `/user/login-user`).
- Replace `<shop_id>`, `<product_id>`, `<order_id>`, `<user_id>`, and `<instructor_id>` with valid MongoDB ObjectIDs.
- Ensure the server is running on `http://localhost:8000` or adjust the base URL accordingly.
- For endpoints requiring images (e.g., `/product/create-product`), provide valid `url` fields. Image uploads to Cloudinary should be handled separately, and the resulting `public_id` and `url` should be included in the request.
- The `/order/create-order` endpoint supports both product and course orders, splitting them by shop or instructor. Ensure `shopId` or `instructorId` matches the item’s associated entity.
- Status transitions for orders are restricted (e.g., `Pending` → `Confirmed` or `Cancelled`). Invalid transitions will result in a `400` error.
- Refund requests (`/order/order-refund`) and approvals (`/order/order-refund-success`) involve balance and stock/enrollment updates, handled within MongoDB