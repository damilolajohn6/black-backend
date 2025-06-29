Social API Documentation
This documentation provides details for the Social API, which enables social networking features such as following users, creating and interacting with posts, messaging, group chats, and administrative actions. The API is built with Express.js, MongoDB, and integrates with Cloudinary for media handling and Socket.IO for real-time communication.


Base URL
http://localhost:8000/api/v2/social

Authentication
Most endpoints require authentication via a JSON Web Token (JWT). Include the token in the Authorization header as Bearer <token>. Some endpoints also require admin privileges.
Content Types

Request Body: application/json for JSON data, multipart/form-data for file uploads.
Response: application/json

Error Handling
Errors are returned with a JSON object containing success: false and an error message. Common HTTP status codes include:

200: Success
201: Resource created
400: Bad request
403: Forbidden (e.g., blocked or suspended user)
404: Resource not found
500: Server error

Endpoints
1. Get All Users
Retrieve a list of users for social interactions, excluding blocked or suspended users.

Method: GET
Path: /users
Authentication: Required
Query Parameters: None
Response:{
  "success": true,
  "users": [
    {
      "_id": "string",
      "username": "string",
      "email": "string",
      "avatar": "string",
      "followedByMe": boolean
    }
  ]
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/users" -H "Authorization: Bearer <your_token>"



2. Follow User
Follow another user.

Method: POST
Path: /follow/:id
Authentication: Required
Parameters:
id: User ID to follow (path parameter)


Response:{
  "success": true,
  "message": "Now following <username>"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/follow/<user_id>" -H "Authorization: Bearer <your_token>"



3. Unfollow User
Unfollow a user.

Method: POST
Path: /unfollow/:id
Authentication: Required
Parameters:
id: User ID to unfollow (path parameter)


Response:{
  "success": true,
  "message": "Unfollowed <username>"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/unfollow/<user_id>" -H "Authorization: Bearer <your_token>"



4. Create Post
Create a new post with optional media (up to 4 items).

Method: POST
Path: /create-post
Authentication: Required
Request Body:{
  "content": "string",
  "media": [
    {
      "url": "string",
      "public_id": "string",
      "type": "image|video"
    }
  ]
}


Response:{
  "success": true,
  "post": {
    "_id": "string",
    "user": "string",
    "content": "string",
    "media": [],
    "likes": [],
    "comments": []
  }
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/create-post" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"content":"Hello world","media":[{"url":"https://example.com/image.jpg","public_id":"image_id","type":"image"}]}'



5. Delete Post
Delete a post and its associated media.

Method: DELETE
Path: /delete-post/:postId
Authentication: Required (must be post owner)
Parameters:
postId: Post ID (path parameter)


Response:{
  "success": true,
  "message": "Post deleted successfully",
  "postId": "string"
}


cURL Example:curl -X DELETE "http://localhost:8000/api/v2/social/delete-post/<post_id>" -H "Authorization: Bearer <your_token>"



6. Like Post
Like a post.

Method: POST
Path: /like-post/:postId
Authentication: Required
Parameters:
postId: Post ID (path parameter)


Response:{
  "success": true,
  "message": "Post liked"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/like-post/<post_id>" -H "Authorization: Bearer <your_token>"



7. Unlike Post
Unlike a post.

Method: POST
Path: /unlike-post/:postId
Authentication: Required
Parameters:
postId: Post ID (path parameter)


Response:{
  "success": true,
  "message": "Post unliked"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/unlike-post/<post_id>" -H "Authorization: Bearer <your_token>"



8. Comment on Post
Add a comment to a post.

Method: POST
Path: /comment-post/:postId
Authentication: Required
Parameters:
postId: Post ID (path parameter)


Request Body:{
  "content": "string"
}


Response:{
  "success": true,
  "post": {
    "_id": "string",
    "user": {},
    "content": "string",
    "media": [],
    "likes": [],
    "comments": []
  }
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/comment-post/<post_id>" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"content":"Great post!"}'



9. Report Post
Report a post for review.

Method: POST
Path: /report-post/:postId
Authentication: Required
Parameters:
postId: Post ID (path parameter)


Request Body:{
  "reason": "string"
}


Response:{
  "success": true,
  "message": "Post reported successfully"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/report-post/<post_id>" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"reason":"Inappropriate content"}'



10. Like Comment
Like a comment on a post.

Method: POST
Path: /like-comment/:postId/:commentId
Authentication: Required
Parameters:
postId: Post ID (path parameter)
commentId: Comment ID (path parameter)


Response:{
  "success": true,
  "post": {}
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/like-comment/<post_id>/<comment_id>" -H "Authorization: Bearer <your_token>"



11. Unlike Comment
Unlike a comment on a post.

Method: POST
Path: /unlike-comment/:postId/:commentId
Authentication: Required
Parameters:
postId: Post ID (path parameter)
commentId: Comment ID (path parameter)


Response:{
  "success": true,
  "post": {}
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/unlike-comment/<post_id>/<comment_id>" -H "Authorization: Bearer <your_token>"



12. Reply to Comment
Reply to a comment on a post.

Method: POST
Path: /reply-comment/:postId/:commentId
Authentication: Required
Parameters:
postId: Post ID (path parameter)
commentId: Comment ID (path parameter)


Request Body:{
  "content": "string"
}


Response:{
  "success": true,
  "post": {}
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/reply-comment/<post_id>/<comment_id>" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"content":"Thanks for the comment!"}'



13. Get User Posts
Retrieve posts by a specific user.

Method: GET
Path: /posts/:userId
Authentication: Optional
Parameters:
userId: User ID (path parameter)


Response:{
  "success": true,
  "posts": []
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/posts/<user_id>" -H "Authorization: Bearer <your_token>"



14. Get My Posts
Retrieve authenticated user's posts.

Method: GET
Path: /my-posts
Authentication: Required
Response:{
  "success": true,
  "posts": []
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/my-posts" -H "Authorization: Bearer <your_token>"



15. Get Timeline Posts
Retrieve posts from users the authenticated user follows.

Method: GET
Path: /timeline
Authentication: Required
Response:{
  "success": true,
  "posts": [
    {
      "user": {},
      "post": {}
    }
  ]
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/timeline" -H "Authorization: Bearer <your_token>"



16. Fetch Random Posts
Retrieve random posts, excluding those from blocked users.

Method: GET
Path: /random-posts
Authentication: Required
Response:{
  "success": true,
  "posts": []
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/random-posts" -H "Authorization: Bearer <your_token>"



17. Get User Profile
Retrieve a user's profile, including followers, following, and posts.

Method: GET
Path: /profile/:id
Authentication: Optional
Parameters:
id: User ID (path parameter)


Response:{
  "success": true,
  "user": {
    "_id": "string",
    "fullname": "string",
    "username": "string",
    "email": "string",
    "avatar": "string",
    "followers": [],
    "following": [],
    "posts": []
  }
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/profile/<user_id>" -H "Authorization: Bearer <your_token>"



18. Get Messages
Retrieve messages between the authenticated user and another user.

Method: GET
Path: /messages/:recipientId
Authentication: Required
Parameters:
recipientId: Recipient's user ID (path parameter)


Response:{
  "success": true,
  "messages": []
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/messages/<recipient_id>" -H "Authorization: Bearer <your_token>"



19. Send Message
Send a direct message with optional media.

Method: POST
Path: /send-message/:receiverId
Authentication: Required
Parameters:
receiverId: Recipient's user ID (path parameter)


Request Body:{
  "content": "string",
  "media": [
    {
      "data": "string",
      "type": "image|video"
    }
  ]
}


Response:{
  "success": true,
  "message": {}
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/send-message/<receiver_id>" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"content":"Hi there!"}'



20. Delete Message
Delete a message sent by the authenticated user.

Method: DELETE
Path: /delete-message/:messageId
Authentication: Required
Parameters:
messageId: Message ID (path parameter)


Response:{
  "success": true,
  "message": "Message deleted successfully",
  "messageId": "string"
}


cURL Example:curl -X DELETE "http://localhost:8000/api/v2/social/delete-message/<message_id>" -H "Authorization: Bearer <your_token>"



21. Reset Social Activity
Delete all posts, messages, and follower relationships for the authenticated user.

Method: DELETE
Path: /reset-social
Authentication: Required
Response:{
  "success": true,
  "message": "Social activity reset successfully"
}


cURL Example:curl -X DELETE "http://localhost:8000/api/v2/social/reset-social" -H "Authorization: Bearer <your_token>"



22. Search Users and Posts
Search for users and posts by query string.

Method: GET
Path: /search
Authentication: Required
Query Parameters:
query: Search term (min 3 characters)
page: Page number (default: 1)
limit: Results per page (default: 10)


Response:{
  "success": true,
  "users": [],
  "posts": [],
  "page": number,
  "limit": number
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/search?query=test&page=1&limit=10" -H "Authorization: Bearer <your_token>"



23. Create Group Chat
Create a group chat with multiple members.

Method: POST
Path: /create-group-chat
Authentication: Required
Request Body:{
  "name": "string",
  "members": ["user_id_1", "user_id_2"]
}


Response:{
  "success": true,
  "group": {},
  "conversation": {}
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/create-group-chat" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"name":"My Group","members":["<user_id_1>","<user_id_2>"]}'



24. Send Group Message
Send a message to a group chat.

Method: POST
Path: /send-group-message/:groupId
Authentication: Required
Parameters:
groupId: Group chat ID (path parameter)


Request Body:{
  "content": "string",
  "media": [
    {
      "data": "string",
      "type": "image|video"
    }
  ]
}


Response:{
  "success": true,
  "message": {}
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/send-group-message/<group_id>" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"content":"Group message!"}'



25. Get Group Messages
Retrieve messages in a group chat.

Method: GET
Path: /group-messages/:groupId
Authentication: Required
Parameters:
groupId: Group chat ID (path parameter)


Response:{
  "success": true,
  "messages": []
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/group-messages/<group_id>" -H "Authorization: Bearer <your_token>"



26. Add Group Member
Add a user to a group chat (admin only).

Method: POST
Path: /add-group-member/:groupId
Authentication: Required (admin)
Parameters:
groupId: Group chat ID (path parameter)


Request Body:{
  "userId": "string"
}


Response:{
  "success": true,
  "message": "Added <username> to the group"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/add-group-member/<group_id>" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"userId":"<user_id>"}'



27. Remove Group Member
Remove a user from a group chat (admin only).

Method: POST
Path: /remove-group-member/:groupId
Authentication: Required (admin)
Parameters:
groupId: Group chat ID (path parameter)


Request Body:{
  "userId": "string"
}


Response:{
  "success": true,
  "message": "Removed <username> from the group"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/remove-group-member/<group_id>" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"userId":"<user_id>"}'



28. Get Admin Reports
Retrieve all reports (admin only).

Method: GET
Path: /admin/reports
Authentication: Required (admin)
Response:{
  "success": true,
  "reports": []
}


cURL Example:curl -X GET "http://localhost:8000/api/v2/social/admin/reports" -H "Authorization: Bearer <your_token>"



29. Suspend User
Suspend a user (admin only).

Method: POST
Path: /admin/suspend-user/:userId
Authentication: Required (admin)
Parameters:
userId: User ID to suspend (path parameter)


Request Body:{
  "reason": "string",
  "durationDays": number
}


Response:{
  "success": true,
  "message": "User <username> suspended successfully"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/admin/suspend-user/<user_id>" -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"reason":"Violation","durationDays":7}'



30. Unsuspend User
Unsuspend a user (admin only).

Method: POST
Path: /admin/unsuspend-user/:userId
Authentication: Required (admin)
Parameters:
userId: User ID to unsuspend (path parameter)


Response:{
  "success": true,
  "message": "User <username> unsuspended successfully"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/admin/unsuspend-user/<user_id>" -H "Authorization: Bearer <your_token>"



31. Delete Reported Content
Delete reported content and resolve the report (admin only).

Method: POST
Path: /admin/delete-reported-content/:reportId
Authentication: Required (admin)
Parameters:
reportId: Report ID (path parameter)


Response:{
  "success": true,
  "message": "Reported content deleted and report resolved"
}


cURL Example:curl -X POST "http://localhost:8000/api/v2/social/admin/delete-reported-content/<report_id>" -H "Authorization: Bearer <your_token>"



Real-Time Events (Socket.IO)
The API uses Socket.IO for real-time communication. Key events include:

newMessage: Emitted when a new direct message is sent.
messageSent: Emitted to the sender to confirm message delivery.
messageDeleted: Emitted when a message is deleted.
groupChatCreated: Emitted when a group chat is created.
newGroupMessage: Emitted when a group message is sent.
groupMemberAdded: Emitted when a member is added to a group.
groupMemberRemoved: Emitted when a member is removed from a group.
userSuspended: Emitted when a user is suspended.
userUnsuspended: Emitted when a user is unsuspended.
contentDeleted: Emitted when reported content is deleted.

Notes

Replace <your_token> with a valid JWT token.
Replace <user_id>, <post_id>, <comment_id>, <message_id>, <group_id>, and <report_id> with valid IDs.
Ensure environment variables for Cloudinary (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are configured.
Media uploads must include valid url, public_id, and type for posts, or data and type for messages.
All endpoints respect block and suspension status, preventing interactions with blocked or suspended users.

