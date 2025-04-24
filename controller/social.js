require("dotenv").config();
const express = require("express");
const router = express.Router();
const cloudinary = require("cloudinary").v2;
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated } = require("../middleware/auth");
const User = require("../model/user");
const Post = require("../model/post");
const Message = require("../model/message");
const Conversation = require("../model/conversation");
const Follower = require("../model/follower");
const { io, getReceiverSocketId } = require("../server"); // Import from server.js

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Get all users for social features
router.get(
  "/users",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const users = await User.find({ _id: { $ne: req.user.id } }).select(
        "_id name email avatar"
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
        message: `Now following ${userToFollow.name}`,
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
        message: `Unfollowed ${userToUnfollow.name}`,
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
        createdAt: new Date(),
      });
      await post.save();

      console.info("comment-post: Comment added", {
        userId: req.user.id,
        postId,
        content: content.substring(0, 50),
      });

      res.status(201).json({
        success: true,
        comment: post.comments[post.comments.length - 1],
      });
    } catch (error) {
      console.error("COMMENT POST ERROR:", error);
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
        .populate("user", "name avatar")
        .populate("comments.user", "name avatar")
        .sort({ createdAt: -1 });

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
        .populate("user", "name avatar")
        .populate("comments.user", "name avatar")
        .sort({ createdAt: -1 });

      const formattedPosts = posts.map((post) => ({
        user: {
          _id: post.user._id,
          name: post.user.name,
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

// Get user profile
router.get(
  "/profile/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id).select(
        "_id name email avatar"
      );
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      const followers = await Follower.find({ followed: req.params.id })
        .populate("follower", "name avatar")
        .select("follower followedAt");
      const following = await Follower.find({ follower: req.params.id })
        .populate("followed", "name avatar")
        .select("followed followedAt");
      const posts = await Post.find({ user: req.params.id })
        .populate("user", "name avatar")
        .populate("comments.user", "name avatar")
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        user: {
          ...user.toObject(),
          followers,
          following,
          posts,
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
        .populate("senderId", "name avatar")
        .populate("receiverId", "name avatar")
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

      // Update or create conversation
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
        .populate("senderId", "name avatar")
        .populate("receiverId", "name avatar");

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
        .populate("members", "name avatar")
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
