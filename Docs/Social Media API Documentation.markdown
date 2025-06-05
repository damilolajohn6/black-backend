# Social Media API Documentation

This document outlines the API endpoints for social media features, including user management, following, posting, liking, commenting, messaging, and conversations. All endpoints require proper authentication where specified, using a JWT token in the `Authorization` header.

Social API Documentation
This document describes the RESTful API endpoints defined in the social.js router for a social media platform. The API supports user interactions such as following/unfollowing users, creating and liking posts, commenting and replying, messaging, and retrieving user profiles and posts. It uses Express.js, MongoDB with Mongoose, and Cloudinary for image uploads, with Socket.IO for real-time messaging.
Table of Contents

Overview
Setup and Dependencies
Authentication
Helper Functions
API Endpoints
Users
GET /users


Follow/Unfollow
POST /follow/:id
POST /unfollow/:id


Posts
POST /create-post
POST /like-post/:postId
POST /unlike-post/:postId
POST /comment-post/:postId
POST /like-comment/:postId/:commentId
POST /unlike-comment/:postId/:commentId
POST /reply-comment/:postId/:commentId
GET /posts/:userId
GET /my-posts
GET /timeline
GET /random-posts


User Profile
GET /profile/:id


Messaging
GET /messages/:recipientId
POST /send-message/:receiverId
POST /create-conversation
GET /conversations




Error Handling
MongoDB Models
Testing the API
Security Considerations
Future Improvements

Overview
The social.js router handles social interactions for a web application, integrating with MongoDB for data persistence, Cloudinary for image storage, and Socket.IO for real-time messaging. Each endpoint is protected by middleware for error handling (catchAsyncErrors) and authentication (isAuthenticated) where required. The API supports CRUD operations for posts, comments, followers, and messages, with population of user data for a seamless frontend experience.
Setup and Dependencies
Dependencies

dotenv: Loads environment variables from a .env file.
express: Web framework for routing.
mongoose: ODM for MongoDB interactions.
cloudinary: Handles image uploads and storage.
Custom Modules:
ErrorHandler: Custom error handling utility.
catchAsyncErrors: Middleware for async error handling.
isAuthenticated: Middleware for JWT-based authentication.
User, Post, Message, Conversation, Follower: Mongoose models.
getIo, getReceiverSocketId: Socket.IO utilities for real-time messaging.



Environment Variables
Ensure the following are set in .env:
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

Authentication
Most endpoints require authentication via the isAuthenticated middleware, which verifies a JWT token and attaches the authenticated user’s ID to req.user.id. Unauthenticated requests return a 401 error. Exceptions are:

GET /posts/:userId (public access to user posts).
GET /profile/:id (public access to user profiles).

Helper Functions
populateComments
Populates user data (username, avatar) for posts, comments, and up to three levels of nested replies.
const populateComments = (query) => {
  return query
    .populate({ path: "user", select: "username avatar" })
    .populate({ path: "comments.user", select: "username avatar" })
    .populate({ path: "comments.replies.user", select: "username avatar" })
    .populate({ path: "comments.replies.replies.user", select: "username avatar" });
};

findComment
Used in comment-related endpoints to locate a comment or nested reply by commentId. Includes validation and error logging to handle edge cases (e.g., invalid IDs, missing comments).
API Endpoints
Users
GET /users
Retrieve all users except the authenticated user, with follow status.

Authentication: Required
Query Parameters: None
Response:{
  "success": true,
  "users": [
    {
      "_id": "string",
      "username": "string",
      "email": "string",
      "avatar": { "public_id": "string", "url": "string" },
      "followedByMe": boolean
    }
  ]
}


Errors:
500: Server error


Example:curl -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/users



Follow/Unfollow
POST /follow/:id
Follow a user by ID.

Authentication: Required
Parameters: id (user ID to follow)
Request Body: None
Response:{
  "success": true,
  "message": "Now following <username>"
}


Errors:
400: Cannot follow yourself, already following
404: User not found
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/follow/<userId>



POST /unfollow/:id
Unfollow a user by ID.

Authentication: Required
Parameters: id (user ID to unfollow)
Request Body: None
Response:{
  "success": true,
  "message": "Unfollowed <username>"
}


Errors:
400: Cannot unfollow yourself, not following
404: User not found
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/unfollow/<userId>



Posts
POST /create-post
Create a new post with optional images.

Authentication: Required
Request Body:{
  "content": "string", // Required, max 280 characters
  "images": ["string"] // Optional, base64-encoded images, max 4
}


Response:{
  "success": true,
  "post": {
    "_id": "string",
    "user": "string",
    "content": "string",
    "images": [{ "public_id": "string", "url": "string" }],
    "likes": ["string"],
    "comments": []
  }
}


Errors:
400: Invalid content length
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
-d '{"content":"Hello world!"}' http://localhost:8000/api/v2/social/create-post



POST /like-post/:postId
Like a post.

Authentication: Required
Parameters: postId (post ID)
Request Body: None
Response:{
  "success": true,
  "message": "Post liked"
}


Errors:
400: Already liked
404: Post not found
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/like-post/<postId>



POST /unlike-post/:postId
Unlike a post.

Authentication: Required
Parameters: postId (post ID)
Request Body: None
Response:{
  "success": true,
  "message": "Post unliked"
}


Errors:
400: Not liked
404: Post not found
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/unlike-post/<postId>



POST /comment-post/:postId
Add a comment to a post.

Authentication: Required
Parameters: postId (post ID)
Request Body:{
  "content": "string" // Required, max 280 characters
}


Response:{
  "success": true,
  "post": {
    "_id": "string",
    "user": { "_id": "string", "username": "string", "avatar": {} },
    "content": "string",
    "comments": [
      {
        "_id": "string",
        "user": { "_id": "string", "username": "string", "avatar": {} },
        "content": "string",
        "likes": [],
        "replies": []
      }
    ]
  }
}


Errors:
400: Invalid content length
404: Post not found
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
-d '{"content":"Nice post!"}' http://localhost:8000/api/v2/social/comment-post/<postId>



POST /like-comment/:postId/:commentId
Like a comment or nested reply.

Authentication: Required
Parameters:
postId (post ID)
commentId (comment or reply ID)


Request Body: None
Response:{
  "success": true,
  "post": { /* Populated post object */ }
}


Errors:
400: Invalid IDs, already liked
404: Post or comment not found
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/like-comment/<postId>/<commentId>



POST /unlike-comment/:postId/:commentId
Unlike a comment or nested reply.

Authentication: Required
Parameters:
postId (post ID)
commentId (comment or reply ID)


Request Body: None
Response:{
  "success": true,
  "post": { /* Populated post object */ }
}


Errors:
400: Invalid IDs, not liked
404: Post or comment not found
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/unlike-comment/<postId>/<commentId>



POST /reply-comment/:postId/:commentId
Reply to a comment or nested reply.

Authentication: Required
Parameters:
postId (post ID)
`commentId** (comment ID to reply to)


Request Body:{
  "content": "string" // Required, max 280 chars
}


Response:{
  "success": true,
  "post": { /* Populated post */ }
}


Errors:
400: Invalid content length, invalid IDs
404: Post or comment not found
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
-d '{"content":"Thanks!"}' http://localhost:8000/api/v2/social/reply-comment/<postId>/<commentId>



GET /posts/:userId
Get posts by a specific user.

Authentication: Not required
Parameters: userId (user ID)
Response:{
  "success": true,
  "posts": [/* Array of populated post objects */]
}


Errors:
500: Server error


Example:curl http://localhost:8000/api/v2/social/posts/<userId>



GET /my-posts
Get authenticated user’s posts.

Authentication: Required
Response:{
  "success": true,
  "posts": [/* Array of populated post objects */]
}


Errors:
500: Server error


Example:curl -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/my-posts



GET /timeline
Get posts from followed users.

Authentication: Required
Response:{
  "success": true,
  "posts": [
    {
      "user": { "_id": "string", "username": "string", "avatar": {} },
      "post": { /* Populated post object */ }
    }
  ]
}


Errors:
500: Server error


Example:curl -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/timeline



GET /random-posts
Get 10 random posts.

Authentication: Required
Response:{
  "success": true,
  "posts": [
    {
      "user": { "_id": "string", "username": "string", "avatar": {} },
      "post": { /* Populated post object */ }
    }
  ],
  "message": "string" // If no posts
}


Errors:
500: Server error


Example:curl -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/random-posts



User Profile
GET /profile/:id
Get a user’s profile, followers, following, and posts.

Authentication: Not required
Parameters: id (user ID)
Response:{
  "success": true,
  "user": {
    "_id": "string",
    "fullname": "string",
    "username": "string",
    "email": "string",
    "avatar": {},
    "followers": [{ "follower": {}, "followedAt": "date" }],
    "following": [{ "followed": {}, "followedAt": "date" }],
    "posts": [/* Populated post objects */]
  }
}


Errors:
400: Invalid user ID
404: User not found
500: Server error


Example:curl http://localhost:8000/api/v2/social/profile/<userId>



Messaging
GET /messages/:recipientId
Get messages between authenticated user and recipient.

Authentication: Required
Parameters: recipientId (user ID)
Response:{
  "success": true,
  "messages": [
    {
      "_id": "string",
      "senderId": { "_id": "string", "username": "string", "avatar": {} },
      "receiverId": { "_id": "string", "username": "string", "avatar": {} },
      "content": "string",
      "image": {},
      "createdAt": "date"
    }
  ]
}


Errors:
500: Server error


Example:curl -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/messages/<recipientId>



POST /send-message/:receiverId
Send a message with optional image.

Authentication: Required
Parameters: receiverId (user ID)
Request Body:{
  "content": "string", // Optional if image provided
  "image": "string" // Optional, base64-encoded
}


Response:{
  "success": true,
  "message": { /* Populated message object */ }
}


Errors:
400: Content or image required
500: Server error


Real-Time: Emits newMessage and messageSent via Socket.IO.
Example:curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
-d '{"content":"Hi!"}' http://localhost:8000/api/v2/social/send-message/<receiverId>



POST /create-conversation
Create a new conversation or return existing one.

Authentication: Required
Request Body:{
  "userId": "string", // Required
  "groupTitle": "string" // Optional
}


Response:{
  "success": true,
  "conversation": {
    "_id": "string",
    "members": ["string"],
    "groupTitle": "string"
  }
}


Errors:
500: Server error


Example:curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
-d '{"userId":"recipientId"}' http://localhost:8000/api/v2/social/create-conversation


GET /conversations
Get all conversations for the authenticated user, including members and last message details.

Authentication: Required
Query Parameters: None
Response:{
  "success": true,
  "conversations": [
    {
      "_id": "string",
      "members": [
        {
          "_id": "string",
          "username": "string",
          "avatar": { "public_id": "string", "url": "string" }
        }
      ],
      "groupTitle": "string",
      "lastMessage": "string",
      "lastMessageId": {
        "_id": "string",
        "content": "string",
        "image": { "public_id": "string", "url": "string" },
        "createdAt": "date"
      },
      "updatedAt": "date"
    }
  ]
}


Errors:
500: Server error


Example:curl -H "Authorization: Bearer <token>" http://localhost:8000/api/v2/social/conversations



Error Handling
All endpoints use the catchAsyncErrors middleware to handle asynchronous errors gracefully. Errors are passed to the ErrorHandler utility, which formats responses as:
{
  "success": false,
  "message": "Error message",
  "statusCode": 400|404|500
}


400 Bad Request: Invalid input (e.g., missing content, invalid IDs).
401 Unauthorized: Missing or invalid JWT token.
404 Not Found: Resource (e.g., user, post, comment) not found.
500 Internal Server Error: Unexpected server issues, logged with console.error.

Detailed error logs are output to the console for debugging, including context-specific information (e.g., user ID, post ID).
MongoDB Models
The API relies on the following Mongoose models (assumed based on usage):
User
{
  _id: ObjectId,
  fullname: String,
  username: String,
  email: String,
  avatar: {
    public_id: String,
    url: String
  }
}

Post
{
  _id: ObjectId,
  user: ObjectId, // References User
  content: String,
  images: [
    {
      public_id: String,
      url: String
    }
  ],
  likes: [ObjectId], // References User
  comments: [
    {
      _id: ObjectId,
      user: ObjectId, // References User
      content: String,
      likes: [ObjectId], // References User
      replies: [Comment], // Recursive, up to 3 levels
      createdAt: Date
    }
  ],
  createdAt: Date
}

Follower
{
  _id: ObjectId,
  follower: ObjectId, // References User
  followed: ObjectId, // References User
  followedAt: Date
}

Message
{
  _id: ObjectId,
  senderId: ObjectId, // References User
  receiverId: ObjectId, // References User
  content: String,
  image: {
    public_id: String,
    url: String
  },
  createdAt: Date
}

Conversation
{
  _id: ObjectId,
  members: [ObjectId], // References User
  groupTitle: String,
  lastMessage: String,
  lastMessageId: ObjectId, // References Message
  updatedAt: Date
}

Testing the API
Tools

Postman or cURL for manual testing.
Jest with supertest for automated tests.
MongoDB Compass for database inspection.

Example Test (Jest + Supertest)
const request = require('supertest');
const app = require('../app'); // Your Express app
const mongoose = require('mongoose');

describe('Social API', () => {
  let token, userId, postId;

  beforeAll(async () => {
    // Connect to test database
    await mongoose.connect('mongodb://localhost/test_db');
    // Register and login to get token
    const res = await request(app)
      .post('/api/v2/auth/login')
      .send({ email: 'test@example.com', password: 'password' });
    token = res.body.token;
    userId = res.body.user._id;
  });

  it('should create a post', async () => {
    const res = await request(app)
      .post('/api/v2/social/create-post')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Test post' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    postId = res.body.post._id;
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });
});

Manual Testing

Start Server:npm start


Test Authentication:Obtain a JWT token via /api/v2/auth/login (assumed endpoint).
Test Endpoints:Use cURL commands provided in the endpoint examples.
Inspect Database:Use MongoDB Compass to verify data (e.g., new posts, comments).
Monitor Logs:Check server logs for errors or info messages.

Security Considerations

Authentication:
Use secure JWT tokens with short expiration.
Validate req.user.id in isAuthenticated middleware.


Input Validation:
Validate ObjectIds with mongoose.isValidObjectId.
Enforce content length limits (280 characters).
Sanitize inputs to prevent XSS (not implemented; recommended).


Rate Limiting:
Add express-rate-limit to prevent abuse:const rateLimit = require('express-rate-limit');
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));




Image Uploads:
Validate image formats and sizes before Cloudinary upload.
Use Cloudinary’s secure URLs.


Data Exposure:
Select only necessary fields in queries (e.g., username, avatar).
Avoid exposing sensitive user data (e.g., passwords, emails in public endpoints).


Socket.IO:
Authenticate Socket.IO connections using JWT.
Prevent unauthorized message emissions.
