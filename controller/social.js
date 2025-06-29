require("dotenv").config();
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const User = require("../model/user");
const Post = require("../model/post");
const Message = require("../model/message");
const Conversation = require("../model/conversation");
const Follower = require("../model/follower");
const Report = require("../model/report");
const GroupChat = require("../model/groupChat");
const Story = require("../model/story");
const sendMail = require("../utils/sendMail");
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
      options: { lean: true },
    })
    .populate({
      path: "comments.user",
      select: "username avatar",
      options: { lean: true },
    })
    .populate({
      path: "comments.replies.user",
      select: "username avatar",
      options: { lean: true },
    })
    .populate({
      path: "comments.replies.replies.user",
      select: "username avatar",
      options: { lean: true },
    })
    .catch((err) => {
      console.error("Populate comments error:", err);
      throw err;
    });
};

// Helper function to check if users have blocked each other
const checkBlockStatus = async (userId, targetUserId) => {
  const [user, targetUser] = await Promise.all([
    User.findById(userId).select("blockedUsers"),
    User.findById(targetUserId).select("blockedUsers"),
  ]);
  if (!user || !targetUser) {
    throw new ErrorHandler("User not found", 404);
  }
  if (user.blockedUsers.includes(targetUserId)) {
    throw new ErrorHandler("You have blocked this user", 403);
  }
  if (targetUser.blockedUsers.includes(userId)) {
    throw new ErrorHandler("You are blocked by this user", 403);
  }
};

// Helper function to check if a user is suspended
const checkSuspensionStatus = async (userId) => {
  const user = await User.findById(userId).select(
    "isSuspended suspensionExpiry"
  );
  if (!user) {
    throw new ErrorHandler("User not found", 404);
  }
  if (
    user.isSuspended &&
    (!user.suspensionExpiry || user.suspensionExpiry > new Date())
  ) {
    throw new ErrorHandler("Your account is suspended", 403);
  }
};

// Helper function to check group membership and admin status
const checkGroupAccess = async (groupId, userId, requireAdmin = false) => {
  const group = await GroupChat.findById(groupId).populate("members admins");
  if (!group) {
    throw new ErrorHandler("Group chat not found", 404);
  }
  if (!group.members.some((member) => member._id.toString() === userId)) {
    throw new ErrorHandler("You are not a member of this group", 403);
  }
  if (
    requireAdmin &&
    !group.admins.some((admin) => admin._id.toString() === userId)
  ) {
    throw new ErrorHandler("Admin privileges required", 403);
  }
  return group;
};

// Helper function to check if users can interact (block and suspension status)
const checkInteractionStatus = async (userId, targetUserIds) => {
  for (const targetId of targetUserIds) {
    await checkBlockStatus(userId, targetId);
    await checkSuspensionStatus(targetId);
  }
  await checkSuspensionStatus(userId);
};

// Get all users for social features
router.get(
  "/users",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const user = await User.findById(req.user.id).select("blockedUsers");
      const users = await User.find({
        _id: { $ne: req.user.id },
        blockedUsers: { $nin: [req.user.id] },
        isSuspended: { $ne: true },
      }).select("_id username email avatar");
      const following = await Follower.find({ follower: req.user.id }).select(
        "followed"
      );
      const followedIds = new Set(following.map((f) => f.followed.toString()));

      const usersWithFollowStatus = users
        .filter((u) => !user.blockedUsers.includes(u._id))
        .map((user) => ({
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
      await checkInteractionStatus(req.user.id, [req.params.id]);
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

      // Send email notification to the followed user
      try {
        const follower = await User.findById(req.user.id).select("username");
        if (userToFollow.notificationPreferences.newFollower) {
          await sendMail({
            email: userToFollow.email,
            subject: "New Follower Notification",
            message: `Hello ${userToFollow.username},\n\nYou have a new follower: ${follower.username}!\n\nBest regards,\nBlacknSell`,
          });
        }
        console.info("follow: Email sent to followed user", {
          followerId: req.user.id,
          followedId: req.params.id,
        });
      } catch (emailError) {
        console.error("FOLLOW EMAIL ERROR:", emailError);
        // Optionally log to a monitoring service, but don't fail the request
      }

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
      await checkSuspensionStatus(req.user.id);
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
      await checkSuspensionStatus(req.user.id);
      const { content, media } = req.body;

      if (!content && (!media || media.length === 0)) {
        return next(
          new ErrorHandler("Post must contain either content or media", 400)
        );
      }

      if (content && content.length > 2800) {
        return next(
          new ErrorHandler("Content must be 2800 characters or less", 400)
        );
      }

      const postMedia = [];
      if (media && Array.isArray(media) && media.length > 0) {
        for (const item of media.slice(0, 4)) {
          if (
            !item.url ||
            !item.public_id ||
            !["image", "video"].includes(item.type)
          ) {
            return next(
              new ErrorHandler(
                "Invalid media format: must include url, public_id, and type (image or video)",
                400
              )
            );
          }
          postMedia.push({
            type: item.type,
            public_id: item.public_id,
            url: item.url,
          });
        }
      }

      const post = await Post.create({
        user: req.user.id,
        content: content || "",
        media: postMedia,
        likes: [],
        comments: [],
      });

      console.info("create-post: Post created", {
        userId: req.user.id,
        postId: post._id,
        content: content ? content.substring(0, 50) : "",
        mediaCount: postMedia.length,
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

// Delete post
router.delete(
  "/delete-post/:postId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { postId } = req.params;
      if (!mongoose.isValidObjectId(postId)) {
        return next(new ErrorHandler("Invalid post ID", 400));
      }

      const post = await Post.findById(postId);
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      if (post.user.toString() !== req.user.id) {
        return next(
          new ErrorHandler("Not authorized to delete this post", 403)
        );
      }

      // Delete associated media from Cloudinary
      if (post.media && post.media.length > 0) {
        for (const mediaItem of post.media) {
          try {
            await cloudinary.uploader.destroy(mediaItem.public_id);
          } catch (error) {
            console.warn(
              "delete-post: Failed to delete media from Cloudinary",
              {
                postId,
                public_id: mediaItem.public_id,
                error: error.message,
              }
            );
          }
        }
      }

      await Post.deleteOne({ _id: postId });

      console.info("delete-post: Post deleted", {
        userId: req.user.id,
        postId,
      });

      res.status(200).json({
        success: true,
        message: "Post deleted successfully",
        postId,
      });
    } catch (error) {
      console.error("DELETE POST ERROR:", error);
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
      await checkInteractionStatus(req.user.id, []);
      const { postId } = req.params;
      const post = await Post.findById(postId).populate("user", "blockedUsers");
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      if (post.user.blockedUsers.includes(req.user.id)) {
        return next(new ErrorHandler("You are blocked by this user", 403));
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
      await checkSuspensionStatus(req.user.id);
      const { postId } = req.params;
      const post = await Post.findById(postId).populate("user", "blockedUsers");
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      if (post.user.blockedUsers.includes(req.user.id)) {
        return next(new ErrorHandler("You are blocked by this user", 403));
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
      await checkInteractionStatus(req.user.id, []);
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

      const post = await Post.findById(postId).populate("user", "blockedUsers username email");
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      if (post.user.blockedUsers.includes(req.user.id)) {
        return next(new ErrorHandler("You are blocked by this user", 403));
      }

      post.comments.push({
        user: req.user.id,
        content,
        likes: [],
        replies: [],
        createdAt: new Date(),
      });
      await post.save();

      // Send email notification to the post owner
      if (post.user._id.toString() !== req.user.id) {
        try {
          const commenter = await User.findById(req.user.id).select("username");
          await sendMail({
            email: post.user.email,
            subject: "New Comment on Your Post",
            message: `Hello ${post.user.username},\n\n${commenter.username} commented on your post: "${content}"\n\nBest regards,\nThe Social Platform Team`,
          });
          console.info("comment-post: Email sent to post owner", {
            userId: req.user.id,
            postId,
          });
        } catch (emailError) {
          console.error("COMMENT POST EMAIL ERROR:", emailError);
        }
      }

      const populatedPost = await populateComments(Post.findById(postId));

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

// Report post
router.post(
  "/report-post/:postId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { postId } = req.params;
      const { reason } = req.body;

      if (!mongoose.isValidObjectId(postId)) {
        return next(new ErrorHandler("Invalid post ID", 400));
      }

      if (!reason || reason.length > 500) {
        return next(
          new ErrorHandler(
            "Report reason is required and must be 500 characters or less",
            400
          )
        );
      }

      const post = await Post.findById(postId);
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      const existingReport = await Report.findOne({
        post: postId,
        user: req.user.id,
      });
      if (existingReport) {
        return next(
          new ErrorHandler("You have already reported this post", 400)
        );
      }

      await Report.create({
        post: postId,
        user: req.user.id,
        reason,
      });

      console.info("report-post: Post reported", {
        userId: req.user.id,
        postId,
        reason: reason.substring(0, 50),
      });

      res.status(201).json({
        success: true,
        message: "Post reported successfully",
      });
    } catch (error) {
      console.error("REPORT POST ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Like comment
router.post(
  "/like-comment/:postId/:commentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkInteractionStatus(req.user.id, []);
      const { postId, commentId } = req.params;
      if (
        !mongoose.isValidObjectId(postId) ||
        !mongoose.isValidObjectId(commentId)
      ) {
        return next(new ErrorHandler("Invalid post or comment ID", 400));
      }

      const post = await Post.findById(postId).populate("user", "blockedUsers");
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      if (post.user.blockedUsers.includes(req.user.id)) {
        return next(new ErrorHandler("You are blocked by this user", 403));
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
            console.warn("findComment: Invalid comment object at index", {
              i,
              comment,
            });
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

// Unlike comment
router.post(
  "/unlike-comment/:postId/:commentId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { postId, commentId } = req.params;
      if (
        !mongoose.isValidObjectId(postId) ||
        !mongoose.isValidObjectId(commentId)
      ) {
        return next(new ErrorHandler("Invalid post or comment ID", 400));
      }

      const post = await Post.findById(postId).populate("user", "blockedUsers");
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      if (post.user.blockedUsers.includes(req.user.id)) {
        return next(new ErrorHandler("You are blocked by this user", 403));
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
            console.warn("findComment: Invalid comment object at index", {
              i,
              comment,
            });
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
      await checkInteractionStatus(req.user.id, []);
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

      const post = await Post.findById(postId).populate("user", "blockedUsers");
      if (!post) {
        return next(new ErrorHandler("Post not found", 404));
      }

      if (post.user.blockedUsers.includes(req.user.id)) {
        return next(new ErrorHandler("You are blocked by this user", 403));
      }

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
      if (req.user) {
        await checkInteractionStatus(req.user.id, [req.params.userId]);
      }

      const posts = await populateComments(
        Post.find({ user: req.params.userId }).sort({ createdAt: -1 }).lean()
      );

      const formattedPosts = posts.map((post) => ({
        user: {
          _id: post.user?._id || null,
          username: post.user?.username || "Unknown",
          avatar: post.user?.avatar || null,
        },
        post: {
          _id: post._id,
          content: post.content || "",
          media: post.media || [],
          likes: post.likes || [],
          comments: (post.comments || []).map((comment) => ({
            _id: comment._id,
            user: {
              _id: comment.user?._id || null,
              username: comment.user?.username || "Unknown",
              avatar: comment.user?.avatar || null,
            },
            content: comment.content || "",
            likes: comment.likes || [],
            replies: (comment.replies || []).map((reply) => ({
              _id: reply._id || new mongoose.Types.ObjectId(),
              user: {
                _id: reply.user?._id || reply.user || null,
                username: reply.user?.username || "Unknown",
                avatar: reply.user?.avatar || null,
              },
              content: reply.content || "",
              likes: reply.likes || [],
              replies: [],
            })),
          })),
        },
      }));

      res.status(200).json({
        success: true,
        posts: formattedPosts,
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
      await checkSuspensionStatus(req.user.id);
      const posts = await populateComments(
        Post.find({ user: req.user.id }).sort({ createdAt: -1 }).lean()
      );

      const formattedPosts = posts.map((post) => ({
        user: {
          _id: post.user?._id || req.user.id,
          username: post.user?.username || req.user.username || "Unknown",
          avatar: post.user?.avatar || req.user.avatar || null,
        },
        post: {
          _id: post._id,
          content: post.content || "",
          media: post.media || [],
          likes: post.likes || [],
          comments: (post.comments || []).map((comment) => ({
            _id: comment._id,
            user: {
              _id: comment.user?._id || null,
              username: comment.user?.username || "Unknown",
              avatar: comment.user?.avatar || null,
            },
            content: comment.content || "",
            likes: comment.likes || [],
            replies: (comment.replies || []).map((reply) => ({
              _id: reply._id || new mongoose.Types.ObjectId(),
              user: {
                _id: reply.user?._id || reply.user || null,
                username: reply.user?.username || "Unknown",
                avatar: reply.user?.avatar || null,
              },
              content: reply.content || "",
              likes: reply.likes || [],
              replies: [],
            })),
          })),
        },
      }));

      res.status(200).json({
        success: true,
        posts: formattedPosts,
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
      await checkSuspensionStatus(req.user.id);
      const user = await User.findById(req.user.id)
        .select("blockedUsers")
        .lean();
      const following = await Follower.find({ follower: req.user.id })
        .select("followed")
        .lean();
      const followedIds = following
        .map((u) => u.followed)
        .filter((id) => !user.blockedUsers?.includes(id));

      const posts = await populateComments(
        Post.find({
          user: { $in: followedIds },
        })
          .sort({ createdAt: -1 })
          .lean()
      );

      const formattedPosts = posts.map((post) => ({
        user: {
          _id: post.user?._id || null,
          username: post.user?.username || "Unknown",
          avatar: post.user?.avatar || null,
        },
        post: {
          _id: post._id,
          content: post.content || "",
          media: post.media || [],
          likes: post.likes || [],
          comments: (post.comments || []).map((comment) => ({
            _id: comment._id,
            user: {
              _id: comment.user?._id || null,
              username: comment.user?.username || "Unknown",
              avatar: comment.user?.avatar || null,
            },
            content: comment.content || "",
            likes: comment.likes || [],
            replies: (comment.replies || []).map((reply) => ({
              _id: reply._id || new mongoose.Types.ObjectId(),
              user: {
                _id: reply.user?._id || reply.user || null,
                username: reply.user?.username || "Unknown",
                avatar: reply.user?.avatar || null,
              },
              content: reply.content || "",
              likes: reply.likes || [],
              replies: [],
            })),
          })),
        },
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
      await checkSuspensionStatus(req.user.id);
      const user = await User.findById(req.user.id)
        .select("blockedUsers")
        .lean();

      const postCount = await Post.countDocuments({
        user: { $nin: user.blockedUsers || [] },
      });

      if (postCount === 0) {
        return res.status(200).json({
          success: true,
          posts: [],
          message: "No posts available in the database.",
        });
      }

      const randomPosts = await populateComments(
        Post.find({
          user: { $nin: user.blockedUsers || [] },
        })
          .skip(Math.floor(Math.random() * postCount))
          .limit(10)
          .sort({ createdAt: -1 })
          .lean()
      );

      const formattedPosts = randomPosts.map((post) => ({
        user: {
          _id: post.user?._id || null,
          username: post.user?.username || "Unknown",
          avatar: post.user?.avatar || null,
        },
        post: {
          _id: post._id,
          content: post.content || "",
          media: post.media || [],
          likes: post.likes || [],
          comments: (post.comments || []).map((comment) => ({
            _id: comment._id,
            user: {
              _id: comment.user?._id || null,
              username: comment.user?.username || "Unknown",
              avatar: comment.user?.avatar || null,
            },
            content: comment.content || "",
            likes: comment.likes || [],
            replies: (comment.replies || []).map((reply) => ({
              _id: reply._id || new mongoose.Types.ObjectId(),
              user: {
                _id: reply.user?._id || reply.user || null,
                username: reply.user?.username || "Unknown",
                avatar: reply.user?.avatar || null,
              },
              content: reply.content || "",
              likes: reply.likes || [],
              replies: [], 
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
      if (req.user) {
        await checkInteractionStatus(req.user.id, [req.params.id]);
      }

      const user = await User.findById(req.params.id)
        .select("_id fullname username email avatar")
        .lean();
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      const [followers, following, posts] = await Promise.all([
        Follower.find({ followed: req.params.id })
          .populate("follower", "fullname username avatar")
          .select("follower followedAt")
          .lean(),
        Follower.find({ follower: req.params.id })
          .populate("followed", "fullname username avatar")
          .select("followed followedAt")
          .lean(),
        populateComments(
          Post.find({ user: req.params.id }).sort({ createdAt: -1 }).lean()
        ),
      ]);

      res.status(200).json({
        success: true,
        user: {
          _id: user._id,
          fullname: user.fullname || {},
          username: user.username || "Unknown",
          email: user.email || "",
          avatar: user.avatar || null,
          followers: followers.map((f) => ({
            follower: f.follower || {
              _id: null,
              username: "Unknown",
              avatar: null,
            },
            followedAt: f.followedAt,
          })),
          following: following.map((f) => ({
            followed: f.followed || {
              _id: null,
              username: "Unknown",
              avatar: null,
            },
            followedAt: f.followedAt,
          })),
          posts: posts.map((p) => ({
            ...p,
            user: p.user || { _id: null, username: "Unknown", avatar: null },
            media: p.media || [],
            comments: (p.comments || []).map((c) => ({
              ...c,
              user: c.user || { _id: null, username: "Unknown", avatar: null },
              replies: (c.replies || []).map((r) => ({
                ...r,
                user: r.user || {
                  _id: null,
                  username: "Unknown",
                  avatar: null,
                },
                replies: [],
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
      await checkInteractionStatus(req.user.id, [req.params.recipientId]);
      const { recipientId } = req.params;
      const myId = req.user._id;

      const messages = await Message.find({
        $or: [
          { senderId: myId, receiverId: recipientId },
          { senderId: recipientId, receiverId: myId },
        ],
        groupId: null,
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
      await checkInteractionStatus(req.user.id, [req.params.receiverId]);
      const { content, media } = req.body;
      const { receiverId } = req.params;
      const senderId = req.user._id;

      if (!content && (!media || !Array.isArray(media) || media.length === 0)) {
        return next(
          new ErrorHandler("Message must contain either content or media", 400)
        );
      }

      const messageMedia = [];
      if (media && Array.isArray(media) && media.length > 0) {
        for (const item of media.slice(0, 4)) {
          if (
            !item.data ||
            !item.type ||
            !["image", "video"].includes(item.type)
          ) {
            return next(
              new ErrorHandler(
                "Invalid media format: must include data and type (image or video)",
                400
              )
            );
          }
          const myCloud = await cloudinary.uploader.upload(item.data, {
            folder: "messages",
            resource_type: item.type === "video" ? "video" : "image",
          });
          messageMedia.push({
            type: item.type,
            public_id: myCloud.public_id,
            url: myCloud.secure_url,
          });
        }
      }

      const message = await Message.create({
        senderId,
        receiverId,
        senderModel: "User",
        receiverModel: "User",
        content: content || "",
        media: messageMedia,
      });

      let conversation = await Conversation.findOne({
        members: { $all: [senderId, receiverId] },
        isGroup: false,
      });

      if (!conversation) {
        conversation = await Conversation.create({
          members: [senderId, receiverId],
          memberModel: "User",
          isGroup: false,
          lastMessage: content || `Sent ${messageMedia.length} media item(s)`,
          lastMessageId: message._id,
        });
      } else {
        conversation.lastMessage =
          content || `Sent ${messageMedia.length} media item(s)`;
        conversation.lastMessageId = message._id;
        await conversation.save();
      }

      const populatedMessage = await Message.findById(message._id)
        .populate("senderId", "username avatar")
        .populate("receiverId", "username avatar");

      // Send email notification to the receiver
      try {
        const sender = await User.findById(senderId).select("username");
        const receiver = await User.findById(receiverId).select("email username");
        await sendMail({
          email: receiver.email,
          subject: "New Message Received",
          message: `Hello ${receiver.username},\n\nYou have received a new message from ${sender.username}:\n\n${
            content || "Media content"
          }\n\nBest regards,\nBlacknSell`,
        });
        console.info("send-message: Email sent to receiver", {
          senderId,
          receiverId,
          messageId: message._id,
        });
      } catch (emailError) {
        console.error("SEND MESSAGE EMAIL ERROR:", emailError);
        // Optionally log to a monitoring service, but don't fail the request
      }

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
        mediaCount: messageMedia.length,
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

// Delete message
router.delete(
  "/delete-message/:messageId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { messageId } = req.params;
      if (!mongoose.isValidObjectId(messageId)) {
        return next(new ErrorHandler("Invalid message ID", 400));
      }

      const message = await Message.findById(messageId);
      if (!message) {
        return next(new ErrorHandler("Message not found", 404));
      }

      if (message.senderId.toString() !== req.user.id) {
        return next(
          new ErrorHandler("Not authorized to delete this message", 403)
        );
      }

      // Delete associated media from Cloudinary
      if (message.media && message.media.length > 0) {
        for (const mediaItem of message.media) {
          try {
            await cloudinary.uploader.destroy(mediaItem.public_id, {
              resource_type: mediaItem.type === "video" ? "video" : "image",
            });
          } catch (error) {
            console.warn(
              "delete-message: Failed to delete media from Cloudinary",
              {
                messageId,
                public_id: mediaItem.public_id,
                error: error.message,
              }
            );
          }
        }
      }

      // Find the conversation and update lastMessage if necessary
      const conversation = await Conversation.findOne({
        lastMessageId: messageId,
        $or: [
          {
            members: { $all: [message.senderId, message.receiverId] },
            isGroup: false,
          },
          { groupId: message.groupId, isGroup: true },
        ],
      });

      if (conversation) {
        const previousMessage = await Message.findOne({
          $or: [
            {
              senderId: message.senderId,
              receiverId: message.receiverId,
              groupId: null,
            },
            {
              senderId: message.receiverId,
              receiverId: message.senderId,
              groupId: null,
            },
            { groupId: message.groupId },
          ],
          _id: { $ne: messageId },
        }).sort({ createdAt: -1 });

        if (previousMessage) {
          conversation.lastMessage =
            previousMessage.content ||
            `Sent ${previousMessage.media.length} media item(s)`;
          conversation.lastMessageId = previousMessage._id;
        } else {
          conversation.lastMessage = null;
          conversation.lastMessageId = null;
        }
        await conversation.save();
      }

      await Message.deleteOne({ _id: messageId });

      // Notify relevant users via socket
      const io = getIo();
      if (message.groupId) {
        const group = await GroupChat.findById(message.groupId);
        if (group) {
          group.members.forEach((memberId) => {
            const socketId = getReceiverSocketId(memberId.toString());
            if (socketId) {
              io.to(socketId).emit("messageDeleted", {
                messageId,
                groupId: message.groupId,
              });
            }
          });
        }
      } else {
        const receiverSocketId = getReceiverSocketId(
          message.receiverId.toString()
        );
        const senderSocketId = getReceiverSocketId(message.senderId.toString());
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("messageDeleted", { messageId });
        }
        if (senderSocketId) {
          io.to(senderSocketId).emit("messageDeleted", { messageId });
        }
      }

      console.info("delete-message: Message deleted", {
        userId: req.user.id,
        messageId,
      });

      res.status(200).json({
        success: true,
        message: "Message deleted successfully",
        messageId,
      });
    } catch (error) {
      console.error("DELETE MESSAGE ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

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
        memberModel: "User", // Added to fix validation error
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

// Create story
router.post(
  "/create-story",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { content, media } = req.body;

      if (!content && (!media || !Array.isArray(media) || media.length === 0)) {
        return next(
          new ErrorHandler("Story must contain either content or media", 400)
        );
      }

      if (content && content.length > 280) {
        return next(
          new ErrorHandler("Content must be 280 characters or less", 400)
        );
      }

      const storyMedia = [];
      if (media && Array.isArray(media) && media.length > 0) {
        for (const item of media.slice(0, 4)) {
          if (
            !item.data ||
            !item.type ||
            !["image", "video"].includes(item.type)
          ) {
            return next(
              new ErrorHandler(
                "Invalid media format: must include data and type (image or video)",
                400
              )
            );
          }
          const myCloud = await cloudinary.uploader.upload(item.data, {
            folder: "stories",
            resource_type: item.type === "video" ? "video" : "image",
          });
          storyMedia.push({
            type: item.type,
            public_id: myCloud.public_id,
            url: myCloud.secure_url,
          });
        }
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

      const story = await Story.create({
        user: req.user.id,
        content: content || "",
        media: storyMedia,
        expiresAt,
        viewers: [],
      });

      const populatedStory = await Story.findById(story._id).populate(
        "user",
        "username avatar"
      );

      console.info("create-story: Story created", {
        userId: req.user.id,
        storyId: story._id,
        content: content ? content.substring(0, 50) : "",
        mediaCount: storyMedia.length,
      });

      res.status(201).json({
        success: true,
        story: populatedStory,
      });
    } catch (error) {
      console.error("CREATE STORY ERROR:", error);
      if (error.code === 11000) {
        return next(new ErrorHandler("Duplicate story error", 400));
      }
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// View user stories
router.get(
  "/stories/:userId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkInteractionStatus(req.user.id, [req.params.userId]);
      const { userId } = req.params;
      const viewerId = req.user.id;

      const stories = await Story.find({
        user: userId,
        expiresAt: { $gt: new Date() },
      })
        .populate("user", "username avatar")
        .populate("viewers.user", "username avatar")
        .sort({ createdAt: -1 });

      // Add viewer to stories if not already viewed
      for (const story of stories) {
        if (
          !story.viewers.some((v) => v.user._id.toString() === viewerId) &&
          story.user._id.toString() !== viewerId
        ) {
          story.viewers.push({ user: viewerId, viewedAt: new Date() });
          await story.save();

          // Notify story owner via socket
          const io = getIo();
          const ownerSocketId = getReceiverSocketId(story.user._id.toString());
          if (ownerSocketId) {
            const updatedStory = await Story.findById(story._id).populate(
              "viewers.user",
              "username avatar"
            );
            io.to(ownerSocketId).emit("storyViewed", {
              storyId: story._id,
              viewerId,
              viewers: updatedStory.viewers,
            });
          }
        }
      }

      console.info("view-stories: Stories viewed", {
        viewerId,
        userId,
        storyCount: stories.length,
      });

      res.status(200).json({
        success: true,
        stories,
      });
    } catch (error) {
      console.error("VIEW STORIES ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// View following stories
router.get(
  "/following-stories",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const user = await User.findById(req.user.id).select("blockedUsers");
      const following = await Follower.find({ follower: req.user.id }).select(
        "followed"
      );
      const followedIds = following
        .map((f) => f.followed)
        .filter((id) => !user.blockedUsers.includes(id));

      const stories = await Story.find({
        user: { $in: followedIds },
        expiresAt: { $gt: new Date() },
      })
        .populate("user", "username avatar")
        .populate("viewers.user", "username avatar")
        .sort({ createdAt: -1 });

      // Add viewer to stories if not already viewed
      const viewerId = req.user.id;
      for (const story of stories) {
        if (
          !story.viewers.some((v) => v.user._id.toString() === viewerId) &&
          story.user._id.toString() !== viewerId
        ) {
          story.viewers.push({ user: viewerId, viewedAt: new Date() });
          await story.save();

          // Notify story owner via socket
          const io = getIo();
          const ownerSocketId = getReceiverSocketId(story.user._id.toString());
          if (ownerSocketId) {
            const updatedStory = await Story.findById(story._id).populate(
              "viewers.user",
              "username avatar"
            );
            io.to(ownerSocketId).emit("storyViewed", {
              storyId: story._id,
              viewerId,
              viewers: updatedStory.viewers,
            });
          }
        }
      }

      console.info("view-following-stories: Following stories viewed", {
        viewerId,
        storyCount: stories.length,
      });

      res.status(200).json({
        success: true,
        stories,
      });
    } catch (error) {
      console.error("VIEW FOLLOWING STORIES ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Delete story
router.delete(
  "/delete-story/:storyId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { storyId } = req.params;
      if (!mongoose.isValidObjectId(storyId)) {
        return next(new ErrorHandler("Invalid story ID", 400));
      }

      const story = await Story.findById(storyId);
      if (!story) {
        return next(new ErrorHandler("Story not found", 404));
      }

      if (story.user.toString() !== req.user.id) {
        return next(
          new ErrorHandler("Not authorized to delete this story", 403)
        );
      }

      // Delete associated media from Cloudinary
      if (story.media && story.media.length > 0) {
        for (const mediaItem of story.media) {
          try {
            await cloudinary.uploader.destroy(mediaItem.public_id, {
              resource_type: mediaItem.type === "video" ? "video" : "image",
            });
          } catch (error) {
            console.warn(
              "delete-story: Failed to delete media from Cloudinary",
              {
                storyId,
                public_id: mediaItem.public_id,
                error: error.message,
              }
            );
          }
        }
      }

      await Story.deleteOne({ _id: storyId });

      console.info("delete-story: Story deleted", {
        userId: req.user.id,
        storyId,
      });

      res.status(200).json({
        success: true,
        message: "Story deleted successfully",
        storyId,
      });
    } catch (error) {
      console.error("DELETE STORY ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update reset-social to include story deletion
router.delete(
  "/reset-social",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const userId = req.user.id;
      const user = await User.findById(userId).select("blockedUsers");

      // Delete all posts and associated media
      const posts = await Post.find({ user: userId });
      for (const post of posts) {
        if (post.media && post.media.length > 0) {
          for (const mediaItem of post.media) {
            try {
              await cloudinary.uploader.destroy(mediaItem.public_id, {
                resource_type: mediaItem.type === "video" ? "video" : "image",
              });
            } catch (error) {
              console.warn(
                "reset-social: Failed to delete post media from Cloudinary",
                {
                  postId: post._id,
                  public_id: mediaItem.public_id,
                  error: error.message,
                }
              );
            }
          }
        }
      }
      await Post.deleteMany({ user: userId });

      // Delete all stories and associated media
      const stories = await Story.find({ user: userId });
      for (const story of stories) {
        if (story.media && story.media.length > 0) {
          for (const mediaItem of story.media) {
            try {
              await cloudinary.uploader.destroy(mediaItem.public_id, {
                resource_type: mediaItem.type === "video" ? "video" : "image",
              });
            } catch (error) {
              console.warn(
                "reset-social: Failed to delete story media from Cloudinary",
                {
                  storyId: story._id,
                  public_id: mediaItem.public_id,
                  error: error.message,
                }
              );
            }
          }
        }
      }
      await Story.deleteMany({ user: userId });

      // Delete all messages sent by the user and associated media
      const messages = await Message.find({ senderId: userId });
      const affectedConversations = new Set();
      for (const message of messages) {
        if (message.media && message.media.length > 0) {
          for (const mediaItem of message.media) {
            try {
              await cloudinary.uploader.destroy(mediaItem.public_id, {
                resource_type: mediaItem.type === "video" ? "video" : "image",
              });
            } catch (error) {
              console.warn(
                "reset-social: Failed to delete message media from Cloudinary",
                {
                  messageId: message._id,
                  public_id: mediaItem.public_id,
                  error: error.message,
                }
              );
            }
          }
        }
        if (message.receiverId) {
          affectedConversations.add(message.receiverId.toString());
        }
        if (message.groupId) {
          affectedConversations.add(message.groupId.toString());
        }
      }
      await Message.deleteMany({ senderId: userId });

      // Update or delete affected conversations
      const conversations = await Conversation.find({
        members: userId,
        members: { $nin: user.blockedUsers },
      });
      const io = getIo();
      for (const conversation of conversations) {
        if (conversation.isGroup) {
          const group = await GroupChat.findById(conversation.groupId);
          if (!group) {
            await Conversation.deleteOne({ _id: conversation._id });
            continue;
          }

          // If user is the only admin, delete the group and associated data
          if (
            group.admins.length === 1 &&
            group.admins[0].toString() === userId
          ) {
            // Delete group messages and their media
            const groupMessages = await Message.find({ groupId: group._id });
            for (const message of groupMessages) {
              if (message.media && message.media.length > 0) {
                for (const mediaItem of message.media) {
                  try {
                    await cloudinary.uploader.destroy(mediaItem.public_id, {
                      resource_type:
                        mediaItem.type === "video" ? "video" : "image",
                    });
                  } catch (error) {
                    console.warn(
                      "reset-social: Failed to delete group message media from Cloudinary",
                      {
                        messageId: message._id,
                        public_id: mediaItem.public_id,
                        error: error.message,
                      }
                    );
                  }
                }
              }
            }
            await Message.deleteMany({ groupId: group._id });

            // Delete group and conversation
            await GroupChat.deleteOne({ _id: group._id });
            await Conversation.deleteOne({ _id: conversation._id });

            // Notify members of group deletion
            group.members.forEach((memberId) => {
              const socketId = getReceiverSocketId(memberId.toString());
              if (socketId && !user.blockedUsers.includes(memberId)) {
                io.to(socketId).emit("groupChatDeleted", {
                  groupId: group._id,
                  conversationId: conversation._id,
                });
              }
            });
          } else {
            // Otherwise, remove user from group and update
            group.members = group.members.filter(
              (id) => id.toString() !== userId
            );
            group.admins = group.admins.filter(
              (id) => id.toString() !== userId
            );
            if (group.members.length < 2) {
              // Delete group if fewer than 2 members remain
              await Message.deleteMany({ groupId: group._id });
              await GroupChat.deleteOne({ _id: group._id });
              await Conversation.deleteOne({ _id: conversation._id });
              group.members.forEach((memberId) => {
                const socketId = getReceiverSocketId(memberId.toString());
                if (socketId && !user.blockedUsers.includes(memberId)) {
                  io.to(socketId).emit("groupChatDeleted", {
                    groupId: group._id,
                    conversationId: conversation._id,
                  });
                }
              });
            } else {
              await group.save();
              const lastMessage = await Message.findOne({
                groupId: group._id,
              }).sort({ createdAt: -1 });
              if (lastMessage) {
                conversation.lastMessage =
                  lastMessage.content ||
                  `Sent ${lastMessage.media.length} media item(s)`;
                conversation.lastMessageId = lastMessage._id;
                conversation.memberModel = "User";
              } else {
                conversation.lastMessage = null;
                conversation.lastMessageId = null;
                conversation.memberModel = "User";
              }
              await conversation.save();
              group.members.forEach((memberId) => {
                const socketId = getReceiverSocketId(memberId.toString());
                if (socketId && !user.blockedUsers.includes(memberId)) {
                  io.to(socketId).emit("conversationUpdated", {
                    conversationId: conversation._id,
                    lastMessage: conversation.lastMessage,
                    lastMessageId: conversation.lastMessageId,
                    groupId: group._id,
                  });
                }
              });
            }
          }
        } else {
          const otherMemberId = conversation.members.find(
            (id) => id.toString() !== userId
          );
          if (!otherMemberId || user.blockedUsers.includes(otherMemberId)) {
            continue;
          }

          const lastMessage = await Message.findOne({
            $or: [
              { senderId: userId, receiverId: otherMemberId },
              { senderId: otherMemberId, receiverId: userId },
            ],
          }).sort({ createdAt: -1 });

          if (lastMessage) {
            conversation.lastMessage =
              lastMessage.content ||
              `Sent ${lastMessage.media.length} media item(s)`;
            conversation.lastMessageId = lastMessage._id;
            conversation.memberModel = "User";
            await conversation.save();
          } else {
            await Conversation.deleteOne({ _id: conversation._id });
          }

          const otherMemberSocketId = getReceiverSocketId(
            otherMemberId.toString()
          );
          if (otherMemberSocketId) {
            io.to(otherMemberSocketId).emit("conversationUpdated", {
              conversationId: conversation._id,
              lastMessage: conversation.lastMessage,
              lastMessageId: conversation.lastMessageId,
            });
          }
        }
      }

      // Delete all follower/following relationships
      await Follower.deleteMany({
        $or: [{ follower: userId }, { followed: userId }],
      });

      // Notify affected users of unfollow
      const followers = await Follower.find({ followed: userId }).select(
        "follower"
      );
      for (const follower of followers) {
        const followerSocketId = getReceiverSocketId(
          follower.follower.toString()
        );
        if (
          followerSocketId &&
          !user.blockedUsers.includes(follower.follower)
        ) {
          io.to(followerSocketId).emit("unfollowed", { userId });
        }
      }

      console.info("reset-social: Social activity reset", { userId });

      res.status(200).json({
        success: true,
        message: "Social activity reset successfully",
      });
    } catch (error) {
      console.error("RESET SOCIAL ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Search users and posts
router.get(
  "/search",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { query, page = 1, limit = 10 } = req.query;
      if (!query || query.length < 3) {
        return next(
          new ErrorHandler("Search query must be at least 3 characters", 400)
        );
      }

      const user = await User.findById(req.user.id).select("blockedUsers");
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Search users
      const userSearch = await User.find({
        $and: [
          { _id: { $ne: req.user.id } },
          { blockedUsers: { $nin: [req.user.id] } },
          { isSuspended: { $ne: true } },
          {
            $or: [
              { username: { $regex: query, $options: "i" } },
              { "fullname.firstName": { $regex: query, $options: "i" } },
              { "fullname.lastName": { $regex: query, $options: "i" } },
            ],
          },
        ],
      })
        .select("_id username avatar")
        .skip(skip)
        .limit(parseInt(limit));

      // Search posts
      const postSearch = await Post.find({
        $and: [
          { user: { $nin: user.blockedUsers } },
          { content: { $regex: query, $options: "i" } },
        ],
      })
        .populate("user", "username avatar")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        users: userSearch,
        posts: postSearch,
        page: parseInt(page),
        limit: parseInt(limit),
      });
    } catch (error) {
      console.error("SEARCH ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Create group chat
router.post(
  "/create-group-chat",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { name, members } = req.body;
      const creatorId = req.user.id;

      if (!name || name.length > 100) {
        return next(
          new ErrorHandler(
            "Group name is required and must be 100 characters or less",
            400
          )
        );
      }

      if (
        !members ||
        !Array.isArray(members) ||
        members.length < 2 ||
        members.length > 50
      ) {
        return next(new ErrorHandler("Group must have 2-50 members", 400));
      }

      if (members.includes(creatorId)) {
        return next(
          new ErrorHandler("Cannot include yourself in members list", 400)
        );
      }

      const uniqueMembers = [...new Set([...members, creatorId])];
      await checkInteractionStatus(
        creatorId,
        uniqueMembers.filter((id) => id !== creatorId)
      );

      const group = await GroupChat.create({
        name,
        members: uniqueMembers,
        admins: [creatorId],
        createdBy: creatorId,
      });

      const conversation = await Conversation.create({
        members: uniqueMembers,
        memberModel: "User", // Added to fix validation error
        isGroup: true,
        groupId: group._id,
      });

      const io = getIo();
      uniqueMembers.forEach((memberId) => {
        const socketId = getReceiverSocketId(memberId.toString());
        if (socketId) {
          io.to(socketId).emit("groupChatCreated", {
            groupId: group._id,
            name,
            members: uniqueMembers,
            conversationId: conversation._id,
          });
        }
      });

      console.info("create-group-chat: Group chat created", {
        creatorId,
        groupId: group._id,
        memberCount: uniqueMembers.length,
      });

      res.status(201).json({
        success: true,
        group,
        conversation,
      });
    } catch (error) {
      console.error("CREATE GROUP CHAT ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Send group message
router.post(
  "/send-group-message/:groupId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { groupId } = req.params;
      const { content, media } = req.body;
      const senderId = req.user.id;

      const group = await checkGroupAccess(groupId, senderId);

      if (!content && (!media || !Array.isArray(media) || media.length === 0)) {
        return next(
          new ErrorHandler("Message must contain either content or media", 400)
        );
      }

      const messageMedia = [];
      if (media && Array.isArray(media) && media.length > 0) {
        for (const item of media.slice(0, 4)) {
          if (
            !item.data ||
            !item.type ||
            !["image", "video"].includes(item.type)
          ) {
            return next(
              new ErrorHandler(
                "Invalid media format: must include data and type (image or video)",
                400
              )
            );
          }
          const myCloud = await cloudinary.uploader.upload(item.data, {
            folder: "group_messages",
            resource_type: item.type === "video" ? "video" : "image",
          });
          messageMedia.push({
            type: item.type,
            public_id: myCloud.public_id,
            url: myCloud.secure_url,
          });
        }
      }

      const message = await Message.create({
        senderId,
        groupId,
        senderModel: "User",
        content: content || "",
        media: messageMedia,
      });

      let conversation = await Conversation.findOne({ groupId, isGroup: true });
      if (!conversation) {
        conversation = await Conversation.create({
          members: group.members,
          memberModel: "User", // Explicitly set memberModel
          isGroup: true,
          groupId,
          lastMessage: content || `Sent ${messageMedia.length} media item(s)`,
          lastMessageId: message._id,
        });
      } else {
        conversation.lastMessage =
          content || `Sent ${messageMedia.length} media item(s)`;
        conversation.lastMessageId = message._id;
        conversation.memberModel = conversation.memberModel || "User"; // Ensure memberModel is set if missing
        await conversation.save();
      }

      group.lastMessage =
        content || `Sent ${messageMedia.length} media item(s)`;
      group.lastMessageId = message._id;
      await group.save();

      const populatedMessage = await Message.findById(message._id).populate(
        "senderId",
        "username avatar"
      );

      const io = getIo();
      group.members.forEach((memberId) => {
        const socketId = getReceiverSocketId(memberId.toString());
        if (socketId) {
          io.to(socketId).emit("newGroupMessage", {
            message: populatedMessage,
            groupId,
            conversationId: conversation._id,
          });
        }
      });

      console.info("send-group-message: Group message sent", {
        senderId,
        groupId,
        messageId: message._id,
        mediaCount: messageMedia.length,
      });

      res.status(201).json({
        success: true,
        message: populatedMessage,
      });
    } catch (error) {
      console.error("SEND GROUP MESSAGE ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get group messages
router.get(
  "/group-messages/:groupId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { groupId } = req.params;
      await checkGroupAccess(groupId, req.user.id);

      const messages = await Message.find({ groupId })
        .populate("senderId", "username avatar")
        .sort({ createdAt: 1 });

      res.status(200).json({
        success: true,
        messages,
      });
    } catch (error) {
      console.error("GET GROUP MESSAGES ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Add group member
router.post(
  "/add-group-member/:groupId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { groupId } = req.params;
      const { userId } = req.body;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      const group = await checkGroupAccess(groupId, req.user.id, true);
      await checkInteractionStatus(req.user.id, [userId]);

      const userToAdd = await User.findById(userId);
      if (!userToAdd) {
        return next(new ErrorHandler("User not found", 404));
      }

      if (group.members.some((member) => member._id.toString() === userId)) {
        return next(new ErrorHandler("User is already a member", 400));
      }

      await GroupChat.updateOne(
        { _id: groupId },
        { $addToSet: { members: userId } }
      );

      let conversation = await Conversation.findOne({ groupId, isGroup: true });
      if (conversation) {
        conversation.members.push(userId);
        await conversation.save();
      }

      // Send email notification to the added user
      try {
        await sendMail({
          email: userToAdd.email,
          subject: "Added to Group Chat",
          message: `Hello ${userToAdd.username},\n\nYou have been added to the group "${group.name}" by ${req.user.username}.\n\nBest regards,\nBlacknSell`,
        });
        console.info("add-group-member: Email sent to added user", {
          groupId,
          userId,
        });
      } catch (emailError) {
        console.error("ADD GROUP MEMBER EMAIL ERROR:", emailError);
        // Optionally log to a monitoring service, but don't fail the request
      }

      const io = getIo();
      group.members.concat([userToAdd]).forEach((member) => {
        const socketId = getReceiverSocketId(member._id.toString());
        if (socketId) {
          io.to(socketId).emit("groupMemberAdded", {
            groupId,
            userId,
            username: userToAdd.username,
          });
        }
      });

      console.info("add-group-member: Member added", {
        groupId,
        userId,
        addedBy: req.user.id,
      });

      res.status(200).json({
        success: true,
        message: `Added ${userToAdd.username} to the group`,
      });
    } catch (error) {
      console.error("ADD GROUP MEMBER ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Add multiple group members
router.post(
  "/add-group-members/:groupId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { groupId } = req.params;
      const { members } = req.body;

      if (
        !members ||
        !Array.isArray(members) ||
        members.length === 0 ||
        members.length > 50
      ) {
        return next(new ErrorHandler("Provide 1-50 valid member IDs", 400));
      }

      const validMemberIds = members.filter((id) =>
        mongoose.isValidObjectId(id)
      );
      if (validMemberIds.length !== members.length) {
        return next(new ErrorHandler("All member IDs must be valid", 400));
      }

      const group = await checkGroupAccess(groupId, req.user.id, true);
      await checkInteractionStatus(req.user.id, validMemberIds);

      const usersToAdd = await User.find({ _id: { $in: validMemberIds } });
      if (usersToAdd.length !== validMemberIds.length) {
        return next(new ErrorHandler("One or more users not found", 404));
      }

      const existingMemberIds = group.members.map((m) => m._id.toString());
      const newMembers = usersToAdd.filter(
        (user) => !existingMemberIds.includes(user._id.toString())
      );
      if (newMembers.length === 0) {
        return next(new ErrorHandler("All users are already members", 400));
      }

      if (group.members.length + newMembers.length > 50) {
        return next(new ErrorHandler("Group cannot exceed 50 members", 400));
      }

      await GroupChat.updateOne(
        { _id: groupId },
        { $addToSet: { members: { $each: newMembers.map((u) => u._id) } } }
      );

      let conversation = await Conversation.findOne({ groupId, isGroup: true });
      if (conversation) {
        conversation.members.push(...newMembers.map((u) => u._id));
        await conversation.save();
      }

      // Send email notifications to all added users
      try {
        for (const user of newMembers) {
          await sendMail({
            email: user.email,
            subject: "Added to Group Chat",
            message: `Hello ${user.username},\n\nYou have been added to the group "${group.name}" by ${req.user.username}.\n\nBest regards,\nBlacknSell`,
          });
          console.info("add-group-members: Email sent to added user", {
            groupId,
            userId: user._id,
          });
        }
      } catch (emailError) {
        console.error("ADD GROUP MEMBERS EMAIL ERROR:", emailError);
        // Optionally log to a monitoring service, but don't fail the request
      }

      const io = getIo();
      group.members.concat(newMembers).forEach((member) => {
        const socketId = getReceiverSocketId(member._id.toString());
        if (socketId) {
          io.to(socketId).emit("groupMembersAdded", {
            groupId,
            members: newMembers.map((u) => ({
              _id: u._id,
              username: u.username,
            })),
          });
        }
      });

      console.info("add-group-members: Members added", {
        groupId,
        memberCount: newMembers.length,
        addedBy: req.user.id,
      });

      res.status(200).json({
        success: true,
        message: `Added ${newMembers.length} member(s) to the group`,
      });
    } catch (error) {
      console.error("ADD GROUP MEMBERS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Remove group member
router.post(
  "/remove-group-member/:groupId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { groupId } = req.params;
      const { userId } = req.body;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      const group = await checkGroupAccess(groupId, req.user.id, true);
      const userToRemove = await User.findById(userId);
      if (!userToRemove) {
        return next(new ErrorHandler("User not found", 404));
      }

      if (!group.members.some((member) => member._id.toString() === userId)) {
        return next(new ErrorHandler("User is not a member", 400));
      }

      group.members = group.members.filter(
        (member) => member._id.toString() !== userId
      );
      group.admins = group.admins.filter(
        (admin) => admin._id.toString() !== userId
      );
      if (group.members.length < 2) {
        await GroupChat.deleteOne({ _id: groupId });
        await Conversation.deleteOne({ groupId, isGroup: true });
      } else {
        await group.save();
        let conversation = await Conversation.findOne({
          groupId,
          isGroup: true,
        });
        if (conversation) {
          conversation.members = conversation.members.filter(
            (member) => member.toString() !== userId
          );
          await conversation.save();
        }
      }

      const io = getIo();
      group.members.forEach((memberId) => {
        const socketId = getReceiverSocketId(memberId.toString());
        if (socketId) {
          io.to(socketId).emit("groupMemberRemoved", {
            groupId,
            userId,
            username: userToRemove.username,
          });
        }
      });
      const removedUserSocketId = getReceiverSocketId(userId);
      if (removedUserSocketId) {
        io.to(removedUserSocketId).emit("groupMemberRemoved", {
          groupId,
          userId,
          username: userToRemove.username,
        });
      }

      console.info("remove-group-member: Member removed", {
        groupId,
        userId,
        removedBy: req.user.id,
      });

      res.status(200).json({
        success: true,
        message: `Removed ${userToRemove.username} from the group`,
      });
    } catch (error) {
      console.error("REMOVE GROUP MEMBER ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update group admins
router.post(
  "/update-group-admins/:groupId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { groupId } = req.params;
      const { admins } = req.body;
      const userId = req.user.id;

      const group = await checkGroupAccess(groupId, userId, true);

      if (!admins || !Array.isArray(admins) || admins.length === 0) {
        return next(new ErrorHandler("Must provide at least one admin", 400));
      }

      if (!admins.includes(userId)) {
        return next(new ErrorHandler("You must remain an admin", 400));
      }

      const uniqueAdmins = [...new Set(admins)];
      if (
        !uniqueAdmins.every((adminId) =>
          group.members.some((m) => m._id.toString() === adminId)
        )
      ) {
        return next(new ErrorHandler("All admins must be group members", 400));
      }

      group.admins = uniqueAdmins;
      await group.save();

      const io = getIo();
      group.members.forEach((memberId) => {
        const socketId = getReceiverSocketId(memberId.toString());
        if (socketId) {
          io.to(socketId).emit("groupUpdated", {
            groupId,
            name: group.name,
            members: group.members,
            admins: group.admins,
          });
        }
      });

      console.info("update-group-admins: Group admins updated", {
        userId,
        groupId,
        adminCount: uniqueAdmins.length,
      });

      res.status(200).json({
        success: true,
        group,
      });
    } catch (error) {
      console.error("UPDATE GROUP ADMINS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Leave group chat
router.post(
  "/leave-group/:groupId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { groupId } = req.params;
      const userId = req.user.id;

      const group = await checkGroupAccess(groupId, userId);

      group.members = group.members.filter(
        (m) => m._id.toString() !== userId
      );
      group.admins = group.admins.filter(
        (a) => a._id.toString() !== userId
      );

      if (group.members.length < 2) {
        await GroupChat.deleteOne({ _id: groupId });
        await Conversation.deleteOne({ groupId, isGroup: true });
        console.info("leave-group: Group deleted due to insufficient members", {
          userId,
          groupId,
        });
      } else {
        if (group.admins.length === 0) {
          group.admins.push(group.members[0]._id);
        }
        await group.save();

        const conversation = await Conversation.findOne({ groupId, isGroup: true });
        if (conversation) {
          conversation.members = group.members;
          await conversation.save();
        }

        console.info("leave-group: User left group", { userId, groupId });
      }

      const io = getIo();
      group.members.forEach((memberId) => {
        const socketId = getReceiverSocketId(memberId.toString());
        if (socketId) {
          io.to(socketId).emit("groupUpdated", {
            groupId,
            name: group.name,
            members: group.members,
            admins: group.admins,
          });
        }
      });

      const userSocketId = getReceiverSocketId(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("leftGroup", { groupId });
      }

      res.status(200).json({
        success: true,
        message: "Left group successfully",
      });
    } catch (error) {
      console.error("LEAVE GROUP ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Delete group chat
router.delete(
  "/delete-group/:groupId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { groupId } = req.params;
      const userId = req.user.id;

      const group = await checkGroupAccess(groupId, userId, true);

      const messages = await Message.find({ groupId });
      for (const message of messages) {
        if (message.media && message.media.length > 0) {
          for (const mediaItem of message.media) {
            try {
              await cloudinary.uploader.destroy(mediaItem.public_id, {
                resource_type: mediaItem.type === "video" ? "video" : "image",
              });
            } catch (error) {
              console.warn(
                "delete-group: Failed to delete message media from Cloudinary",
                {
                  groupId,
                  public_id: mediaItem.public_id,
                  error: error.message,
                }
              );
            }
          }
        }
      }

      await Message.deleteMany({ groupId });
      await Conversation.deleteOne({ groupId, isGroup: true });
      await GroupChat.deleteOne({ _id: groupId });

      const io = getIo();
      group.members.forEach((memberId) => {
        const socketId = getReceiverSocketId(memberId.toString());
        if (socketId) {
          io.to(socketId).emit("groupDeleted", { groupId });
        }
      });

      console.info("delete-group: Group chat deleted", { userId, groupId });

      res.status(200).json({
        success: true,
        message: "Group chat deleted successfully",
      });
    } catch (error) {
      console.error("DELETE GROUP ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get group chat details
router.get(
  "/group/:groupId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { groupId } = req.params;
      const userId = req.user.id;

      const group = await checkGroupAccess(groupId, userId);
      const populatedGroup = await GroupChat.findById(groupId)
        .populate("members", "username avatar")
        .populate("admins", "username avatar")
        .populate("createdBy", "username avatar")
        .populate("lastMessageId", "content media createdAt");

      res.status(200).json({
        success: true,
        group: populatedGroup,
      });
    } catch (error) {
      console.error("GET GROUP ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all group chats for user
router.get(
  "/group-chats",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const userId = req.user.id;

      const groups = await GroupChat.find({
        members: userId,
      })
        .populate("members", "username avatar")
        .populate("admins", "username avatar")
        .populate("createdBy", "username avatar")
        .populate("lastMessageId", "content media createdAt")
        .sort({ updatedAt: -1 });

      res.status(200).json({
        success: true,
        groups,
      });
    } catch (error) {
      console.error("GET GROUP CHATS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);


// Get admin reports
router.get(
  "/admin/reports",
  isAuthenticated,
  isAdmin("admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const reports = await Report.find()
        .populate("user", "username")
        .populate("reportedUser", "username")
        .populate("post", "content")
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        reports,
      });
    } catch (error) {
      console.error("GET ADMIN REPORTS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Suspend user
router.post(
  "/admin/suspend-user/:userId",
  isAuthenticated,
  isAdmin("admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { userId } = req.params;
      const { reason, durationDays } = req.body;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      if (!reason || reason.length > 500) {
        return next(
          new ErrorHandler(
            "Reason is required and must be 500 characters or less",
            400
          )
        );
      }

      if (durationDays && (isNaN(durationDays) || durationDays <= 0)) {
        return next(
          new ErrorHandler("Duration must be a positive number", 400)
        );
      }

      const user = await User.findById(userId);
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      if (user.role === "admin") {
        return next(new ErrorHandler("Cannot suspend an admin", 403));
      }

      user.isSuspended = true;
      user.suspensionReason = reason;
      user.suspensionExpiry = durationDays
        ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
        : null;
      await user.save();

      // Send email notification to the suspended user
      try {
        await sendMail({
          email: user.email,
          subject: "Account Suspension Notice",
          message: `Hello ${user.username},\n\nYour account has been suspended due to: ${reason}.\n\n${
            durationDays
              ? `The suspension will last until ${user.suspensionExpiry.toDateString()}.`
              : "This suspension is indefinite."
          }\n\nPlease contact support for further details.\n\nBest regards,\nThe Social Platform Team`,
        });
        console.info("suspend-user: Email sent to suspended user", {
          userId,
        });
      } catch (emailError) {
        console.error("SUSPEND USER EMAIL ERROR:", emailError);
      }

      const io = getIo();
      const userSocketId = getReceiverSocketId(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("userSuspended", {
          reason,
          expiry: user.suspensionExpiry,
        });
      }

      console.info("suspend-user: User suspended", {
        userId,
        adminId: req.user.id,
        reason: reason.substring(0, 50),
        durationDays: durationDays || "indefinite",
      });

      res.status(200).json({
        success: true,
        message: `User ${user.username} suspended successfully`,
      });
    } catch (error) {
      console.error("SUSPEND USER ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Unsuspend user
router.post(
  "/admin/unsuspend-user/:userId",
  isAuthenticated,
  isAdmin("admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { userId } = req.params;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      const user = await User.findById(userId);
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      if (!user.isSuspended) {
        return next(new ErrorHandler("User is not suspended", 400));
      }

      user.isSuspended = false;
      user.suspensionReason = null;
      user.suspensionExpiry = null;
      await user.save();

      const io = getIo();
      const userSocketId = getReceiverSocketId(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("userUnsuspended", {
          message: "Your account has been unsuspended",
        });
      }

      console.info("unsuspend-user: User unsuspended", {
        userId,
        adminId: req.user.id,
      });

      res.status(200).json({
        success: true,
        message: `User ${user.username} unsuspended successfully`,
      });
    } catch (error) {
      console.error("UNSUSPEND USER ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Delete reported content
router.post(
  "/admin/delete-reported-content/:reportId",
  isAuthenticated,
  isAdmin("admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { reportId } = req.params;

      if (!mongoose.isValidObjectId(reportId)) {
        return next(new ErrorHandler("Invalid report ID", 400));
      }

      const report = await Report.findById(reportId)
        .populate("post")
        .populate("message");
      if (!report) {
        return next(new ErrorHandler("Report not found", 404));
      }

      const io = getIo();

      if (report.post) {
        const post = await Post.findById(report.post._id).populate("user", "email username");
        if (post) {
          // Delete associated media from Cloudinary
          if (post.media && post.media.length > 0) {
            for (const mediaItem of post.media) {
              try {
                await cloudinary.uploader.destroy(mediaItem.public_id, {
                  resource_type: mediaItem.type === "video" ? "video" : "image",
                });
              } catch (error) {
                console.warn(
                  "delete-reported-content: Failed to delete post media",
                  {
                    postId: post._id,
                    public_id: mediaItem.public_id,
                    error: error.message,
                  }
                );
              }
            }
          }
          await Post.deleteOne({ _id: post._id });

          // Send email notification to the post owner
          try {
            await sendMail({
              email: post.user.email,
              subject: "Post Removed",
              message: `Hello ${post.user.username},\n\nYour post has been removed due to a violation reported with reason: ${report.reason}.\n\nPlease review our community guidelines.\n\nBest regards,\nThe Social Platform Team`,
            });
            console.info("delete-reported-content: Email sent to post owner", {
              postId: post._id,
              userId: post.user._id,
            });
          } catch (emailError) {
            console.error("DELETE POST EMAIL ERROR:", emailError);
          }

          const userSocketId = getReceiverSocketId(post.user._id.toString());
          if (userSocketId) {
            io.to(userSocketId).emit("contentDeleted", {
              type: "post",
              id: post._id,
              message: "Your post was removed due to a violation",
            });
          }

          console.info("delete-reported-content: Post deleted", {
            reportId,
            postId: post._id,
            adminId: req.user.id,
          });
        }
      } else if (report.message) {
        const message = await Message.findById(report.message._id).populate(
          "senderId",
          "email username"
        );
        if (message) {
          // Delete associated media from Cloudinary
          if (message.media && message.media.length > 0) {
            for (const mediaItem of message.media) {
              try {
                await cloudinary.uploader.destroy(mediaItem.public_id, {
                  resource_type: mediaItem.type === "video" ? "video" : "image",
                });
              } catch (error) {
                console.warn(
                  "delete-reported-content: Failed to delete message media",
                  {
                    messageId: message._id,
                    public_id: mediaItem.public_id,
                    error: error.message,
                  }
                );
              }
            }
          }

          // Update conversation if this was the last message
          const conversation = await Conversation.findOne({
            lastMessageId: message._id,
            $or: [
              {
                members: { $all: [message.senderId, message.receiverId] },
                isGroup: false,
              },
              { groupId: message.groupId, isGroup: true },
            ],
          });

          if (conversation) {
            const previousMessage = await Message.findOne({
              $or: [
                {
                  senderId: message.senderId,
                  receiverId: message.receiverId,
                  groupId: null,
                },
                {
                  senderId: message.receiverId,
                  receiverId: message.senderId,
                  groupId: null,
                },
                { groupId: message.groupId },
              ],
              _id: { $ne: message._id },
            }).sort({ createdAt: -1 });

            if (previousMessage) {
              conversation.lastMessage =
                previousMessage.content ||
                `Sent ${previousMessage.media.length} media item(s)`;
              conversation.lastMessageId = previousMessage._id;
            } else {
              conversation.lastMessage = null;
              conversation.lastMessageId = null;
            }
            await conversation.save();
          }

          await Message.deleteOne({ _id: message._id });

          // Send email notification to the message sender
          try {
            await sendMail({
              email: message.senderId.email,
              subject: "Message Removed",
              message: `Hello ${message.senderId.username},\n\nYour message has been removed due to a violation reported with reason: ${report.reason}.\n\nPlease review our community guidelines.\n\nBest regards,\nThe Social Platform Team`,
            });
            console.info("delete-reported-content: Email sent to message sender", {
              messageId: message._id,
              userId: message.senderId._id,
            });
          } catch (emailError) {
            console.error("DELETE MESSAGE EMAIL ERROR:", emailError);
          }

          // Notify relevant users
          if (message.groupId) {
            const group = await GroupChat.findById(message.groupId);
            if (group) {
              group.members.forEach((memberId) => {
                const socketId = getReceiverSocketId(memberId.toString());
                if (socketId) {
                  io.to(socketId).emit("contentDeleted", {
                    type: "message",
                    id: message._id,
                    groupId: message.groupId,
                    message:
                      "A message in your group was removed due to a violation",
                  });
                }
              });
            }
          } else {
            const receiverSocketId = getReceiverSocketId(
              message.receiverId.toString()
            );
            const senderSocketId = getReceiverSocketId(
              message.senderId.toString()
            );
            if (receiverSocketId) {
              io.to(receiverSocketId).emit("contentDeleted", {
                type: "message",
                id: message._id,
                message: "A message was removed due to a violation",
              });
            }
            if (senderSocketId) {
              io.to(senderSocketId).emit("contentDeleted", {
                type: "message",
                id: message._id,
                message: "Your message was removed due to a violation",
              });
            }
          }

          console.info("delete-reported-content: Message deleted", {
            reportId,
            messageId: message._id,
            adminId: req.user.id,
          });
        }
      }

      // Mark report as resolved
      await Report.deleteOne({ _id: reportId });

      res.status(200).json({
        success: true,
        message: "Reported content deleted and report resolved",
      });
    } catch (error) {
      console.error("DELETE REPORTED CONTENT ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Fix broken user references in posts
router.post(
  "/admin/fix-post-users",
  isAuthenticated,
  //isAdmin("admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const posts = await Post.find().lean();
      const userIds = [...new Set(posts.map((post) => post.user?.toString()).filter(Boolean))];
      const users = await User.find({ _id: { $in: userIds } }).select("_id").lean();
      const validUserIds = new Set(users.map((user) => user._id.toString()));

      let fixedCount = 0;
      const updates = [];

      for (const post of posts) {
        if (post.user && !validUserIds.has(post.user.toString())) {
          console.warn("fix-post-users: Invalid user reference found", {
            postId: post._id,
            userId: post.user,
          });
          updates.push({
            updateOne: {
              filter: { _id: post._id },
              update: { $set: { user: null } }, // Or set to a default user ID if applicable
            },
          });
          fixedCount++;
        }
      }

      if (updates.length > 0) {
        await Post.bulkWrite(updates);
      }

      console.info("fix-post-users: User references fixed", {
        adminId: req.user.id,
        fixedCount,
      });

      res.status(200).json({
        success: true,
        message: `Fixed ${fixedCount} post(s) with invalid user references`,
        fixedCount,
      });
    } catch (error) {
      console.error("FIX POST USERS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
