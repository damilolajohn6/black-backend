require("dotenv").config();
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated } = require("../middleware/auth");
const User = require("../model/user");
const Post = require("../model/post");
const Message = require("../model/message");
const Conversation = require("../model/conversation");
const Follower = require("../model/follower");
const { getIo, getReceiverSocketId } = require("../socketInstance");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Helper function to populate comments and replies recursively
const populateComments = (query) => {
  return query
    .populate({
      path: "user",
      select: "username avatar",
    })
    .populate({
      path: "comments.user",
      select: "username avatar",
    })
    .populate({
      path: "comments.replies.user",
      select: "username avatar",
    })
    .populate({
      path: "comments.replies.replies.user",
      select: "username avatar",
    }); // Limit to 3 levels of nesting
};

// Get all users for social features
router.get(
  "/users",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const users = await User.find({ _id: { $ne: req.user.id } }).select(
        "_id username email avatar"
      );
      const following = await Follower.find({ follower: req.user.id }).select(
        "followed"
      );
      const followedIds = new Set(following.map((f) => f.followed.toString()));

      const usersWithFollowStatus = users.map((user) => ({
        ...user.toObject(),
        followedByMe: followedIds.has(user._id.toString()),
      }));

      res.status(200).json({
        success: true,
        users: usersWithFollowStatus,
      });
    } catch (error) {
      console.error("ALL USERS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Follow user
router.post(
  "/follow/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const userToFollow = await User.findById(req.params.id);
      if (!userToFollow) {
        return next(new ErrorHandler("User not found", 404));
      }

      if (req.user.id === req.params.id) {
        return next(new ErrorHandler("Cannot follow yourself", 400));
      }

      const existingFollow = await Follower.findOne({
        follower: req.user.id,
        followed: req.params.id,
      });
      if (existingFollow) {
        return next(new ErrorHandler("Already following this user", 400));
      }

      await Follower.create({
        follower: req.user.id,
        followed: req.params.id,
      });

      console.info("follow: User followed", {
        followerId: req.user.id,
        followedId: req.params.id,
      });

      res.status(200).json({
        success: true,
        message: `Now following ${userToFollow.username}`,
      });
    } catch (error) {
      console.error("FOLLOW ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Unfollow user
router.post(
  "/unfollow/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const userToUnfollow = await User.findById(req.params.id);
      if (!userToUnfollow) {
        return next(new ErrorHandler("User not found", 404));
      }

      if (req.user.id === req.params.id) {
        return next(new ErrorHandler("Cannot unfollow yourself", 400));
      }

      const follow = await Follower.findOneAndDelete({
        follower: req.user.id,
        followed: req.params.id,
      });

      if (!follow) {
        return next(new ErrorHandler("Not following this user", 400));
      }

      console.info("unfollow: User unfollowed", {
        followerId: req.user.id,
        followedId: req.params.id,
      });

      res.status(200).json({
        success: true,
        message: `Unfollowed ${userToUnfollow.username}`,
      });
    } catch (error) {
      console.error("UNFOLLOW ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Create post
router.post(
  "/create-post",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { content, images } = req.body;

      if (!content || content.length > 280) {
        return next(
          new ErrorHandler(
            "Content is required and must be 280 characters or less",
            400
          )
        );
      }

      const postImages = [];
      if (images && images.length > 0) {
        for (const image of images.slice(0, 4)) {
          const myCloud = await cloudinary.uploader.upload(image, {
            folder: "posts",
          });
          postImages.push({
            public_id: myCloud.public_id,
            url: myCloud.secure_url,
          });
        }
      }

      const post = await Post.create({
        user: req.user.id,
        content,
        images: postImages,
        likes: [],
        comments: [],
      });

      console.info("create-post: Post created", {
        userId: req.user.id,
        postId: post._id,
        content: content.substring(0, 50),
        imageCount: postImages.length,
      });

      res.status(201).json({
        success: true,
        post,
      });
    } catch (error) {
      console.error("CREATE POST ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Like post
router.post(
  "/like-post/:postId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { postId } = req.params;
      const post = await Post.findById(postId);

      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      if (post.likes.includes(req.user.id)) {
        return next(new ErrorHandler("Post already liked", 400));
      }

      post.likes.push(req.user.id);
      await post.save();

      console.info("like-post: Post liked", {
        userId: req.user.id,
        postId,
      });

      res.status(200).json({
        success: true,
        message: "Post liked",
      });
    } catch (error) {
      console.error("LIKE POST ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Unlike post
router.post(
  "/unlike-post/:postId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { postId } = req.params;
      const post = await Post.findById(postId);

      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      if (!post.likes.includes(req.user.id)) {
        return next(new ErrorHandler("Post not liked", 400));
      }

      post.likes = post.likes.filter((id) => id.toString() !== req.user.id);
      await post.save();

      console.info("unlike-post: Post unliked", {
        userId: req.user.id,
        postId,
      });

      res.status(200).json({
        success: true,
        message: "Post unliked",
      });
    } catch (error) {
      console.error("UNLIKE POST ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Comment on post
router.post(
  "/comment-post/:postId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { postId } = req.params;
      const { content } = req.body;

      if (!content || content.length > 280) {
        return next(
          new ErrorHandler(
            "Comment is required and must be 280 characters or less",
            400
          )
        );
      }

      const post = await Post.findById(postId);
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      post.comments.push({
        user: req.user.id,
        content,
        likes: [],
        replies: [],
        createdAt: new Date(),
      });
      await post.save();

      const populatedPost = await Post.findById(postId).populate([
        { path: "user", select: "username avatar" },
        { path: "comments.user", select: "username avatar" },
        { path: "comments.replies.user", select: "username avatar" },
        { path: "comments.replies.replies.user", select: "username avatar" },
      ]);

      console.info("comment-post: Comment added", {
        userId: req.user.id,
        postId,
        content: content.substring(0, 50),
      });

      res.status(201).json({
        success: true,
        post: populatedPost,
      });
    } catch (error) {
      console.error("COMMENT POST ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Like comment
// social.js
router.post(
  "/like-comment/:postId/:commentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { postId, commentId } = req.params;
      if (!mongoose.isValidObjectId(postId) || !mongoose.isValidObjectId(commentId)) {
        return next(new ErrorHandler("Invalid post or comment ID", 400));
      }

      const post = await Post.findById(postId);
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      let targetComment = null;
      let parentPath = null;

      const findComment = (comments, path) => {
        if (!Array.isArray(comments)) {
          console.error("findComment: Comments is not an array", { comments });
          return false;
        }
        for (let i = 0; i < comments.length; i++) {
          const comment = comments[i];
          if (!comment || !comment._id) {
            console.warn("findComment: Invalid comment object at index", { i, comment });
            continue;
          }
          try {
            if (comment._id.toString() === commentId) {
              targetComment = comment;
              parentPath = path;
              return true;
            }
            if (Array.isArray(comment.replies) && comment.replies.length > 0) {
              if (findComment(comment.replies, `${path}.replies.${i}`)) {
                return true;
              }
            }
          } catch (error) {
            console.error("findComment: Error processing comment", {
              commentId,
              comment,
              error: error.message,
            });
            return false;
          }
        }
        return false;
      };

      if (!findComment(post.comments, "comments")) {
        return next(new ErrorHandler("Comment not found", 404));
      }

      if (targetComment.likes.includes(req.user.id)) {
        return next(new ErrorHandler("Comment already liked", 400));
      }

      targetComment.likes.push(req.user.id);
      await post.save();

      const populatedPost = await Post.findById(postId).populate([
        { path: "user", select: "username avatar" },
        { path: "comments.user", select: "username avatar" },
        { path: "comments.replies.user", select: "username avatar" },
        { path: "comments.replies.replies.user", select: "username avatar" },
      ]);

      console.info("like-comment: Comment liked", {
        userId: req.user.id,
        postId,
        commentId,
      });

      res.status(200).json({
        success: true,
        post: populatedPost,
      });
    } catch (error) {
      console.error("LIKE COMMENT ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Similarly update /unlike-comment/:postId/:commentId
router.post(
  "/unlike-comment/:postId/:commentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { postId, commentId } = req.params;
      if (!mongoose.isValidObjectId(postId) || !mongoose.isValidObjectId(commentId)) {
        return next(new ErrorHandler("Invalid post or comment ID", 400));
      }

      const post = await Post.findById(postId);
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      let targetComment = null;
      let parentPath = null;

      const findComment = (comments, path) => {
        if (!Array.isArray(comments)) {
          console.error("findComment: Comments is not an array", { comments });
          return false;
        }
        for (let i = 0; i < comments.length; i++) {
          const comment = comments[i];
          if (!comment || !comment._id) {
            console.warn("findComment: Invalid comment object at index", { i, comment });
            continue;
          }
          try {
            if (comment._id.toString() === commentId) {
              targetComment = comment;
              parentPath = path;
              return true;
            }
            if (Array.isArray(comment.replies) && comment.replies.length > 0) {
              if (findComment(comment.replies, `${path}.replies.${i}`)) {
                return true;
              }
            }
          } catch (error) {
            console.error("findComment: Error processing comment", {
              commentId,
              comment,
              error: error.message,
            });
            return false;
          }
        }
        return false;
      };

      if (!findComment(post.comments, "comments")) {
        return next(new ErrorHandler("Comment not found", 404));
      }

      if (!targetComment.likes.includes(req.user.id)) {
        return next(new ErrorHandler("Comment not liked", 400));
      }

      targetComment.likes = targetComment.likes.filter(
        (id) => id.toString() !== req.user.id
      );
      await post.save();

      const populatedPost = await Post.findById(postId).populate([
        { path: "user", select: "username avatar" },
        { path: "comments.user", select: "username avatar" },
        { path: "comments.replies.user", select: "username avatar" },
        { path: "comments.replies.replies.user", select: "username avatar" },
      ]);

      console.info("unlike-comment: Comment unliked", {
        userId: req.user.id,
        postId,
        commentId,
      });

      res.status(200).json({
        success: true,
        post: populatedPost,
      });
    } catch (error) {
      console.error("UNLIKE COMMENT ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);


// Reply to comment
router.post(
  "/reply-comment/:postId/:commentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { postId, commentId } = req.params;
      const { content } = req.body;

      if (!content || content.length > 280) {
        return next(
          new ErrorHandler(
            "Reply is required and must be 280 characters or less",
            400
          )
        );
      }

      const post = await Post.findById(postId);
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      // Find comment or reply
      let targetComment = null;
      let parentPath = null;

      const findComment = (comments, path) => {
        for (let i = 0; i < comments.length; i++) {
          if (comments[i]._id.toString() === commentId) {
            targetComment = comments[i];
            parentPath = path;
            return true;
          }
          if (
            comments[i].replies &&
            findComment(comments[i].replies, `${path}.replies.${i}`)
          ) {
            return true;
          }
        }
        return false;
      };

      if (!findComment(post.comments, "comments")) {
        return next(new ErrorHandler("Comment not found", 404));
      }

      targetComment.replies.push({
        user: req.user.id,
        content,
        likes: [],
        replies: [],
        createdAt: new Date(),
      });
      await post.save();

      const populatedPost = await Post.findById(postId).populate([
        { path: "user", select: "username avatar" },
        { path: "comments.user", select: "username avatar" },
        { path: "comments.replies.user", select: "username avatar" },
        { path: "comments.replies.replies.user", select: "username avatar" },
      ]);

      console.info("reply-comment: Reply added", {
        userId: req.user.id,
        postId,
        commentId,
        content: content.substring(0, 50),
      });

      res.status(201).json({
        success: true,
        post: populatedPost,
      });
    } catch (error) {
      console.error("REPLY COMMENT ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get user posts
router.get(
  "/posts/:userId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const posts = await Post.find({ user: req.params.userId })
        .sort({ createdAt: -1 })
        .populate([
          { path: "user", select: "username avatar" },
          { path: "comments.user", select: "username avatar" },
          { path: "comments.replies.user", select: "username avatar" },
          { path: "comments.replies.replies.user", select: "username avatar" },
        ]);

      res.status(200).json({
        success: true,
        posts,
      });
    } catch (error) {
      console.error("GET POSTS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get my posts
router.get(
  "/my-posts",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const posts = await Post.find({ user: req.user.id })
        .sort({ createdAt: -1 })
        .populate([
          { path: "user", select: "username avatar" },
          { path: "comments.user", select: "username avatar" },
          { path: "comments.replies.user", select: "username avatar" },
          { path: "comments.replies.replies.user", select: "username avatar" },
        ]);

      res.status(200).json({
        success: true,
        posts,
      });
    } catch (error) {
      console.error("GET MY POSTS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get timeline posts
router.get(
  "/timeline",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const following = await Follower.find({ follower: req.user.id }).select(
        "followed"
      );
      const followedIds = following.map((f) => f.followed);

      const posts = await Post.find({ user: { $in: followedIds } })
        .sort({ createdAt: -1 })
        .populate([
          { path: "user", select: "username avatar" },
          { path: "comments.user", select: "username avatar" },
          { path: "comments.replies.user", select: "username avatar" },
          { path: "comments.replies.replies.user", select: "username avatar" },
        ]);

      const formattedPosts = posts.map((post) => ({
        user: {
          _id: post.user._id,
          username: post.user.username || "unknown",
          avatar: post.user.avatar,
        },
        post,
      }));

      res.status(200).json({
        success: true,
        posts: formattedPosts,
      });
    } catch (error) {
      console.error("TIMELINE ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Fetch random posts
router.get(
  "/random-posts",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const postCount = await Post.countDocuments();
      if (postCount === 0) {
        return res.status(200).json({
          success: true,
          posts: [],
          message: "No posts available in the database.",
        });
      }

      // Fetch random posts using find and random skip
      const randomPosts = await Post.find()
        .skip(Math.floor(Math.random() * postCount))
        .limit(10)
        .populate([
          { path: "user", select: "username avatar" },
          { path: "comments.user", select: "username avatar" },
          { path: "comments.replies.user", select: "username avatar" },
          { path: "comments.replies.replies.user", select: "username avatar" },
        ])
        .sort({ createdAt: -1 });

      const formattedPosts = randomPosts.map((post) => ({
        user: {
          _id: post.user?._id || null,
          username: post.user?.username || "unknown",
          avatar: post.user?.avatar || null,
        },
        post: {
          _id: post._id,
          content: post.content || "",
          images: post.images || [],
          likes: post.likes || [],
          comments: (post.comments || []).map((comment) => ({
            _id: comment._id,
            user: {
              _id: comment.user?._id || null,
              username: comment.user?.username || "unknown",
              avatar: comment.user?.avatar || null,
            },
            content: comment.content || "",
            likes: comment.likes || [],
            replies: (comment.replies || []).map((reply) => ({
              _id: reply._id,
              user: {
                _id: reply.user?._id || null,
                username: reply.user?.username || "unknown",
                avatar: reply.user?.avatar || null,
              },
              content: reply.content || "",
              likes: reply.likes || [],
              replies: (reply.replies || []).map((nestedReply) => ({
                _id: nestedReply._id,
                user: {
                  _id: nestedReply.user?._id || null,
                  username: nestedReply.user?.username || "unknown",
                  avatar: nestedReply.user?.avatar || null,
                },
                content: nestedReply.content || "",
                likes: nestedReply.likes || [],
                replies: [],
              })),
            })),
          })),
        },
      }));

      res.status(200).json({
        success: true,
        posts: formattedPosts,
      });
    } catch (error) {
      console.error("RANDOM POSTS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get user profile
router.get(
  "/profile/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return next(new ErrorHandler("Invalid user ID format", 400));
      }

      const user = await User.findById(id).select(
        "_id fullname username email avatar"
      );
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      const followers = await Follower.find({ followed: id })
        .populate("follower", "fullname username avatar")
        .select("follower followedAt");
      const following = await Follower.find({ follower: id })
        .populate("followed", "fullname username avatar")
        .select("followed followedAt");
      const posts = await Post.find({ user: id })
        .sort({ createdAt: -1 })
        .populate([
          { path: "user", select: "fullname username avatar" },
          { path: "comments.user", select: "fullname username avatar" },
          { path: "comments.replies.user", select: "fullname username avatar" },
          {
            path: "comments.replies.replies.user",
            select: "fullname username avatar",
          },
        ]);

      res.status(200).json({
        success: true,
        user: {
          _id: user._id,
          fullname: user.fullname,
          username: user.username,
          email: user.email,
          avatar: user.avatar || null,
          followers: followers.map((f) => ({
            follower: f.follower || null,
            followedAt: f.followedAt,
          })),
          following: following.map((f) => ({
            followed: f.followed || null,
            followedAt: f.followedAt,
          })),
          posts: posts.map((p) => ({
            ...p.toObject(),
            user: p.user || null,
            comments: p.comments.map((c) => ({
              ...c,
              user: c.user || null,
              replies: c.replies.map((r) => ({
                ...r,
                user: r.user || null,
                replies: r.replies || [],
              })),
            })),
          })),
        },
      });
    } catch (error) {
      console.error("GET PROFILE ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get messages
router.get(
  "/messages/:recipientId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { recipientId } = req.params;
      const myId = req.user._id;

      const messages = await Message.find({
        $or: [
          { senderId: myId, receiverId: recipientId },
          { senderId: recipientId, receiverId: myId },
        ],
      })
        .populate("senderId", "username avatar")
        .populate("receiverId", "username avatar")
        .sort({ createdAt: 1 });

      res.status(200).json({
        success: true,
        messages,
      });
    } catch (error) {
      console.error("GET MESSAGES ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Send message
router.post(
  "/send-message/:receiverId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { content, image } = req.body;
      const { receiverId } = req.params;
      const senderId = req.user._id;

      if (!content && !image) {
        return next(new ErrorHandler("Content or image is required", 400));
      }

      let imageData = {};
      if (image) {
        const myCloud = await cloudinary.uploader.upload(image, {
          folder: "messages",
        });
        imageData = {
          public_id: myCloud.public_id,
          url: myCloud.secure_url,
        };
      }

      const message = await Message.create({
        senderId,
        receiverId,
        content: content || "",
        image: imageData,
      });

      let conversation = await Conversation.findOne({
        members: { $all: [senderId, receiverId] },
      });

      if (!conversation) {
        conversation = await Conversation.create({
          members: [senderId, receiverId],
          lastMessage: content || "Image sent",
          lastMessageId: message._id,
        });
      } else {
        conversation.lastMessage = content || "Image sent";
        conversation.lastMessageId = message._id;
        await conversation.save();
      }

      const populatedMessage = await Message.findById(message._id)
        .populate("senderId", "username avatar")
        .populate("receiverId", "username avatar");

      const io = getIo();
      const receiverSocketId = getReceiverSocketId(receiverId);
      const senderSocketId = getReceiverSocketId(senderId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("newMessage", populatedMessage);
      }
      if (senderSocketId) {
        io.to(senderSocketId).emit("messageSent", populatedMessage);
      }

      console.info("send-message: Message sent", {
        senderId,
        receiverId,
        messageId: message._id,
      });

      res.status(201).json({
        success: true,
        message: populatedMessage,
      });
    } catch (error) {
      console.error("SEND MESSAGE ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Create new conversation
router.post(
  "/create-conversation",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { userId, groupTitle } = req.body;
      const senderId = req.user._id;

      const isConversationExist = await Conversation.findOne({
        members: { $all: [senderId, userId] },
      });

      if (isConversationExist) {
        return res.status(200).json({
          success: true,
          conversation: isConversationExist,
        });
      }

      const conversation = await Conversation.create({
        members: [senderId, userId],
        groupTitle: groupTitle || "",
      });

      console.info("create-conversation: Conversation created", {
        conversationId: conversation._id,
        members: conversation.members,
      });

      res.status(201).json({
        success: true,
        conversation,
      });
    } catch (error) {
      console.error("CREATE CONVERSATION ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get user conversations
router.get(
  "/conversations",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const conversations = await Conversation.find({
        members: { $in: [req.user._id] },
      })
        .populate("members", "username avatar")
        .populate("lastMessageId", "content image createdAt")
        .sort({ updatedAt: -1 });

      res.status(200).json({
        success: true,
        conversations,
      });
    } catch (error) {
      console.error("GET CONVERSATIONS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
