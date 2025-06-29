require("dotenv").config();
const express = require("express");
const { body, query } = require("express-validator");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const sendMail = require("../utils/sendMail");
const Shop = require("../model/shop");
const User = require("../model/user");
const Message = require("../model/message");
const Order = require("../model/order");
const Conversation = require("../model/conversation");
const { isAuthenticated, isSeller, isAdmin } = require("../middleware/auth");
const cloudinary = require("cloudinary").v2;
const ErrorHandler = require("../utils/ErrorHandler");
const sendShopToken = require("../utils/shopToken");
const { getIo, getReceiverSocketId } = require("../socketInstance");
const logger = require("../utils/logger"); // Import logger

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Rate limiter for messaging endpoints
const messageRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 messages per window
  message: "Too many messages sent, please try again later",
});

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
    throw new ErrorHandler("User account is suspended", 403);
  }
};

// Helper function to check if a shop is verified
const checkShopStatus = async (shopId) => {
  const shop = await Shop.findById(shopId).select("isVerified");
  if (!shop) {
    throw new ErrorHandler("Shop not found", 404);
  }
  if (!shop.isVerified) {
    throw new ErrorHandler("Shop is not verified", 403);
  }
};

// Helper function to check if users have blocked each other
const checkBlockStatus = async (userId, shopId) => {
  const user = await User.findById(userId).select("blockedShops");
  const shop = await Shop.findById(shopId).select("blockedUsers");
  if (!user || !shop) {
    throw new ErrorHandler("User or Shop not found", 404);
  }
  if (user.blockedShops && user.blockedShops.includes(shopId)) {
    throw new ErrorHandler("You have blocked this shop", 403);
  }
  if (shop.blockedUsers && shop.blockedUsers.includes(userId)) {
    throw new ErrorHandler("You are blocked by this shop", 403);
  }
};

// Helper function to send email notification
const sendMessageNotification = async (recipient, sender, messageContent) => {
  const recipientName =
    recipient.fullname?.firstName || recipient.username || recipient.name;
  const senderName =
    sender.fullname?.firstName || sender.username || sender.name;
  try {
    await sendMail({
      email: recipient.email,
      subject: `New Message from ${senderName}`,
      message: `Hello ${recipientName},\n\nYou have a new message from ${senderName}: "${messageContent.substring(
        0,
        50
      )}${
        messageContent.length > 50 ? "..." : ""
      }".\n\nLog in to view the full message.`,
    });
  } catch (error) {
    logger.error("sendMessageNotification: Failed to send email", {
      recipientId: recipient._id,
      senderId: sender._id,
      error: error.message,
    });
  }
};

// Create shop
router.post(
  "/create-shop",
  [
    body("email").isEmail().withMessage("Invalid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("fullname.firstName").notEmpty().withMessage("First name is required"),
    body("fullname.lastName").notEmpty().withMessage("Last name is required"),
    body("name").notEmpty().withMessage("Shop name is required"),
    body("address").notEmpty().withMessage("Address is required"),
    body("zipCode")
      .isNumeric()
      .withMessage("Zip code must be a number")
      .notEmpty()
      .withMessage("Zip code is required"),
    body("phone.countryCode")
      .optional()
      .matches(/^\+\d{1,3}$/)
      .withMessage("Invalid country code (e.g., +1, +44)"),
    body("phone.number")
      .optional()
      .matches(/^\d{7,15}$/)
      .withMessage("Phone number must be 7-15 digits"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const {
        fullname,
        name,
        email,
        password,
        avatar,
        address,
        zipCode,
        phone,
      } = req.body;

      const shopEmail = await Shop.findOne({ email });
      if (shopEmail) {
        return next(
          new ErrorHandler("Shop with this email already exists", 400)
        );
      }

      const shop = {
        fullname,
        name,
        email,
        password,
        address,
        zipCode,
        phoneNumber:
          phone && phone.countryCode && phone.number ? phone : undefined,
        avatar: avatar || { public_id: "", url: "" },
        role: "Seller",
        verificationOtp: Math.floor(100000 + Math.random() * 900000).toString(),
        verificationOtpExpiry: Date.now() + 10 * 60 * 1000,
        isVerified: false,
      };

      try {
        await sendMail({
          email: shop.email,
          subject: "Activate your shop account",
          message: `Hello ${shop.fullname.firstName}, your OTP to activate your shop account is ${shop.verificationOtp}. It expires in 10 minutes.`,
        });

        await Shop.create(shop);
        logger.info("create-shop: Shop created successfully", {
          email: shop.email,
          shopId: shop._id,
        });

        res.status(201).json({
          success: true,
          message: `Please check your email (${shop.email}) to activate your shop account with the OTP!`,
        });
      } catch (error) {
        logger.error("create-shop: Failed to send OTP email", {
          email: shop.email,
          error: error.message,
        });
        return next(new ErrorHandler(error.message, 500));
      }
    } catch (error) {
      logger.error("create-shop: Error creating shop", {
        email: req.body.email,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Activate shop
router.post(
  "/activation",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) {
        return next(new ErrorHandler("Email and OTP are required", 400));
      }
      const shop = await Shop.findOne({ email });
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 400));
      }
      if (shop.isVerified) {
        return next(new ErrorHandler("Shop already verified", 400));
      }
      if (
        shop.verificationOtp !== otp ||
        shop.verificationOtpExpiry < Date.now()
      ) {
        return next(new ErrorHandler("Invalid or expired OTP", 400));
      }
      shop.isVerified = true;
      shop.verificationOtp = undefined;
      shop.verificationOtpExpiry = undefined;
      await shop.save();
      const token = shop.getJwtToken();
      logger.info("activation: Shop activated successfully", {
        shopId: shop._id,
        email,
      });
      sendShopToken(shop, 201, res, token);
    } catch (error) {
      logger.error("activation: Error activating shop", {
        email: req.body.email,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Resend OTP
router.post(
  "/resend-otp",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email } = req.body;
      if (!email) {
        return next(new ErrorHandler("Email is required", 400));
      }

      const shop = await Shop.findOne({ email });
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 400));
      }
      if (shop.isVerified) {
        return next(new ErrorHandler("Shop already verified", 400));
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = Date.now() + 10 * 60 * 1000;

      shop.verificationOtp = otp;
      shop.verificationOtpExpiry = otpExpiry;
      await shop.save();

      try {
        await sendMail({
          email: shop.email,
          subject: "Activate your shop account - New OTP",
          message: `Hello ${shop.fullname.firstName}, your new OTP to activate your shop account is ${otp}. It expires in 10 minutes.`,
        });
        logger.info("resend-otp: OTP resent successfully", { email });

        res.status(200).json({
          success: true,
          message: `A new OTP has been sent to ${shop.email}.`,
        });
      } catch (error) {
        logger.error("resend-otp: Failed to send OTP email", {
          email,
          error: error.message,
        });
        return next(new ErrorHandler("Failed to send OTP email", 500));
      }
    } catch (error) {
      logger.error("resend-otp: Error resending OTP", {
        email: req.body.email,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Forgot password
router.post(
  "/forgot-password",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email } = req.body;
      logger.debug("forgot-password: Request received", { email });
      if (!email) {
        return next(new ErrorHandler("Email is required", 400));
      }

      const shop = await Shop.findOne({ email });
      logger.debug("forgot-password: Shop lookup", {
        email,
        found: !!shop,
        shopId: shop?._id,
      });
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 400));
      }

      const resetToken = shop.createPasswordResetToken();
      await shop.save();
      logger.debug("forgot-password: Reset token generated", {
        shopId: shop._id,
        resetToken,
      });

      try {
        await sendMail({
          email: shop.email,
          subject: "Reset your shop password",
          message: `Hello ${shop.fullname.firstName}, your OTP to reset your shop password is ${resetToken}. It expires in 10 minutes.`,
        });
        logger.info("forgot-password: Reset OTP email sent", {
          shopId: shop._id,
          email,
        });

        res.status(200).json({
          success: true,
          message: `A password reset OTP has been sent to ${shop.email}.`,
        });
      } catch (error) {
        logger.error("forgot-password: Failed to send reset OTP email", {
          shopId: shop._id,
          email,
          error: error.message,
        });
        shop.resetPasswordToken = undefined;
        shop.resetPasswordTime = undefined;
        await shop.save();
        return next(new ErrorHandler("Failed to send reset OTP email", 500));
      }
    } catch (error) {
      logger.error("forgot-password: Error processing request", {
        email: req.body.email,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Reset password
router.post(
  "/reset-password",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, otp, newPassword } = req.body;
      logger.debug("reset-password: Request received", { email });
      if (!email || !otp || !newPassword) {
        return next(
          new ErrorHandler("Email, OTP, and new password are required", 400)
        );
      }

      if (newPassword.length < 6) {
        return next(
          new ErrorHandler("Password must be at least 6 characters", 400)
        );
      }

      const shop = await Shop.findOne({ email }).select("+password");
      logger.debug("reset-password: Shop lookup", {
        email,
        found: !!shop,
        shopId: shop?._id,
      });
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 400));
      }

      if (
        shop.resetPasswordToken !== otp ||
        shop.resetPasswordTime < Date.now()
      ) {
        return next(new ErrorHandler("Invalid or expired OTP", 400));
      }

      shop.password = newPassword;
      shop.resetPasswordToken = undefined;
      shop.resetPasswordTime = undefined;
      await shop.save();
      logger.info("reset-password: Password reset successfully", {
        shopId: shop._id,
        email,
      });

      res.status(200).json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      logger.error("reset-password: Error resetting password", {
        email: req.body.email,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Login shop
router.post(
  "/login-shop",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return next(new ErrorHandler("Please provide all fields!", 400));
      }
      const shop = await Shop.findOne({ email }).select("+password");
      if (!shop) {
        return next(new ErrorHandler("Shop doesn't exist!", 400));
      }
      if (!shop.isVerified) {
        return next(
          new ErrorHandler("Please verify your shop account first!", 400)
        );
      }
      const isPasswordValid = await shop.comparePassword(password);
      if (!isPasswordValid) {
        return next(new ErrorHandler("Invalid credentials", 400));
      }
      const token = shop.getJwtToken();
      logger.info("login-shop: Shop logged in successfully", {
        shopId: shop._id,
        email,
      });
      sendShopToken(shop, 201, res, token);
    } catch (error) {
      logger.error("login-shop: Error logging in shop", {
        email: req.body.email,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Load shop
router.get(
  "/getshop",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const shop = await Shop.findById(req.seller.id);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }
      logger.info("getshop: Shop retrieved successfully", {
        shopId: shop._id,
      });
      res.status(200).json({
        success: true,
        seller: shop,
        token: req.seller.token,
      });
    } catch (error) {
      logger.error("getshop: Error retrieving shop", {
        shopId: req.seller.id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Log out from shop
router.get(
  "/logout",
  catchAsyncErrors(async (req, res, next) => {
    try {
      res.cookie("seller_token", null, {
        expires: new Date(Date.now()),
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
      logger.info("logout: Shop logged out successfully", {
        shopId: req.seller?._id || "unknown",
      });
      res.status(200).json({
        success: true,
        message: "Shop logged out successfully",
      });
    } catch (error) {
      logger.error("logout: Error logging out shop", {
        shopId: req.seller?._id || "unknown",
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get shop info
router.get(
  "/get-shop-info/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const shop = await Shop.findById(req.params.id);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }
      logger.info("get-shop-info: Shop info retrieved successfully", {
        shopId: req.params.id,
      });
      res.set("Cache-Control", "no-store");
      res.status(200).json({
        success: true,
        shop,
      });
    } catch (error) {
      logger.error("get-shop-info: Error retrieving shop info", {
        shopId: req.params.id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update shop profile picture
router.put(
  "/update-shop-avatar",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      let existsSeller = await Shop.findById(req.seller.id);
      if (existsSeller.avatar.public_id) {
        await cloudinary.v2.uploader.destroy(existsSeller.avatar.public_id);
      }
      const myCloud = await cloudinary.v2.uploader.upload(req.body.avatar, {
        folder: "avatars",
        width: 150,
      });
      existsSeller.avatar = {
        public_id: myCloud.public_id,
        url: myCloud.secure_url,
      };
      await existsSeller.save();
      logger.info("update-shop-avatar: Shop avatar updated successfully", {
        shopId: req.seller.id,
      });
      res.status(200).json({
        success: true,
        seller: existsSeller,
      });
    } catch (error) {
      logger.error("update-shop-avatar: Error updating shop avatar", {
        shopId: req.seller.id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update seller info
router.put(
  "/update-seller-info",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { fullname, name, description, address, phoneNumber, zipCode } =
        req.body;
      const shop = await Shop.findById(req.seller.id);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 400));
      }

      shop.fullname = fullname || shop.fullname;
      shop.name = name || shop.name;
      shop.description = description || shop.description;
      shop.address = address || shop.address;
      shop.phoneNumber = phoneNumber || shop.phoneNumber;
      shop.zipCode = zipCode || shop.zipCode;
      await shop.save();
      logger.info("update-seller-info: Seller info updated successfully", {
        shopId: req.seller.id,
      });
      res.status(201).json({
        success: true,
        shop,
      });
    } catch (error) {
      logger.error("update-seller-info: Error updating seller info", {
        shopId: req.seller.id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Create shop review
router.post(
  "/create-shop-review/:shopId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { shopId } = req.params;
      const { rating, comment, images } = req.body;

      if (!rating || rating < 1 || rating > 5) {
        return next(
          new ErrorHandler("Please provide a rating between 1-5", 400)
        );
      }

      const shop = await Shop.findById(shopId);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }

      const alreadyReviewed = shop.reviews.find(
        (r) => r.user.toString() === req.user._id.toString()
      );

      if (alreadyReviewed) {
        return next(
          new ErrorHandler("You have already reviewed this shop", 400)
        );
      }

      const hasPurchased = await Order.exists({
        customer: req.user._id,
        shop: shopId,
        status: "Delivered",
      });

      if (!hasPurchased && req.user.role !== "admin") {
        return next(
          new ErrorHandler(
            "You must purchase from this shop before leaving a review",
            403
          )
        );
      }

      const imagesLinks = [];
      if (images && Array.isArray(images)) {
        for (let i = 0; i < Math.min(images.length, 5); i++) {
          try {
            const result = await cloudinary.v2.uploader.upload(images[i], {
              folder: "reviews",
            });
            imagesLinks.push({
              public_id: result.public_id,
              url: result.secure_url,
            });
          } catch (uploadError) {
            logger.error("create-shop-review: Image upload failed", {
              shopId,
              userId: req.user._id,
              error: uploadError.message,
            });
          }
        }
      }

      const review = {
        user: req.user._id,
        name: req.user.fullname?.firstName || req.user.username,
        rating: Number(rating),
        comment: comment || "",
        images: imagesLinks,
        createdAt: new Date(),
      };

      shop.reviews.push(review);
      shop.ratings =
        shop.reviews.reduce((acc, item) => item.rating + acc, 0) /
        shop.reviews.length;
      shop.numOfReviews = shop.reviews.length;

      await shop.save();

      const user = await User.findById(req.user._id).select("username avatar");
      logger.info("create-shop-review: Review created successfully", {
        shopId,
        userId: req.user._id,
        reviewId: shop.reviews[shop.reviews.length - 1]._id,
      });

      res.status(201).json({
        success: true,
        review: {
          ...review,
          _id: shop.reviews[shop.reviews.length - 1]._id,
          user: {
            username: user.username,
            avatar: user.avatar,
          },
        },
        shareLink: `${process.env.FRONTEND_URL}/shop/${shopId}/reviews/${
          shop.reviews[shop.reviews.length - 1]._id
        }`,
      });
    } catch (error) {
      logger.error("create-shop-review: Error creating review", {
        shopId: req.params.shopId,
        userId: req.user._id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get shop review by ID (publicly accessible)
router.get(
  "/get-shop-review/:shopId/:reviewId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { shopId, reviewId } = req.params;

      const shop = await Shop.findById(shopId);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }

      const review = shop.reviews.id(reviewId);
      if (!review) {
        return next(new ErrorHandler("Review not found", 404));
      }

      const user = await User.findById(review.user).select("username avatar");
      logger.info("get-shop-review: Review retrieved successfully", {
        shopId,
        reviewId,
      });

      res.status(200).json({
        success: true,
        review: {
          ...review.toObject(),
          user: {
            username: user.username,
            avatar: user.avatar,
          },
        },
        shop: {
          name: shop.name,
          avatar: shop.avatar,
          _id: shop._id,
        },
      });
    } catch (error) {
      logger.error("get-shop-review: Error retrieving review", {
        shopId: req.params.shopId,
        reviewId: req.params.reviewId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all shop reviews
router.get(
  "/get-shop-reviews/:shopId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10 } = req.query;
      const skip = (page - 1) * limit;

      const shop = await Shop.findById(req.params.shopId);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }

      const reviews = shop.reviews.slice(skip, skip + limit);

      const reviewsWithUser = await Promise.all(
        reviews.map(async (review) => {
          const user = await User.findById(review.user).select(
            "username avatar"
          );
          return {
            ...review.toObject(),
            user: {
              username: user.username,
              avatar: user.avatar,
            },
          };
        })
      );
      logger.info("get-shop-reviews: Reviews retrieved successfully", {
        shopId: req.params.shopId,
        reviewCount: reviews.length,
      });

      res.status(200).json({
        success: true,
        reviews: reviewsWithUser,
        totalReviews: shop.reviews.length,
        page: Number(page),
        pages: Math.ceil(shop.reviews.length / limit),
      });
    } catch (error) {
      logger.error("get-shop-reviews: Error retrieving reviews", {
        shopId: req.params.shopId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update notification preferences
router.put(
  "/update-notification-preferences",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { receiveMessageEmails } = req.body;
      const shop = await Shop.findById(req.seller.id);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 400));
      }
      shop.notificationPreferences = {
        ...shop.notificationPreferences,
        receiveMessageEmails:
          receiveMessageEmails ??
          shop.notificationPreferences.receiveMessageEmails,
      };
      await shop.save();
      logger.info("update-notification-preferences: Preferences updated", {
        shopId: req.seller.id,
      });
      res.status(200).json({
        success: true,
        shop,
      });
    } catch (error) {
      logger.error(
        "update-notification-preferences: Error updating preferences",
        {
          shopId: req.seller.id,
          error: error.message,
        }
      );
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// All sellers --- for admin
router.get(
  "/admin-all-sellers",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const sellers = await Shop.find().sort({ createdAt: -1 });
      logger.info("admin-all-sellers: Sellers retrieved successfully", {
        sellerCount: sellers.length,
        adminId: req.user._id,
      });
      res.status(201).json({
        success: true,
        sellers,
      });
    } catch (error) {
      logger.error("admin-all-sellers: Error retrieving sellers", {
        adminId: req.user._id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Delete seller --- admin
router.delete(
  "/delete-seller/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const seller = await Shop.findById(req.params.id);
      if (!seller) {
        return next(
          new ErrorHandler("Seller is not available with this id", 400)
        );
      }
      await Shop.findByIdAndDelete(req.params.id);
      logger.info("delete-seller: Seller deleted successfully", {
        sellerId: req.params.id,
        adminId: req.user._id,
      });
      res.status(201).json({
        success: true,
        message: "Seller deleted successfully!",
      });
    } catch (error) {
      logger.error("delete-seller: Error deleting seller", {
        sellerId: req.params.id,
        adminId: req.user._id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update seller withdraw methods --- sellers
router.put(
  "/update-payment-methods",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { withdrawMethod } = req.body;
      const seller = await Shop.findByIdAndUpdate(req.seller.id, {
        withdrawMethod,
      });
      logger.info("update-payment-methods: Payment methods updated", {
        shopId: req.seller.id,
      });
      res.status(201).json({
        success: true,
        seller,
      });
    } catch (error) {
      logger.error("update-payment-methods: Error updating payment methods", {
        shopId: req.seller.id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Delete seller withdraw methods --- only seller
router.delete(
  "/delete-withdraw-method/",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const seller = await Shop.findById(req.seller.id);
      if (!seller) {
        return next(new ErrorHandler("Seller not found with this id", 400));
      }
      seller.withdrawMethod = null;
      await seller.save();
      logger.info("delete-withdraw-method: Withdraw method deleted", {
        shopId: req.seller.id,
      });
      res.status(201).json({
        success: true,
        seller,
      });
    } catch (error) {
      logger.error("delete-withdraw-method: Error deleting withdraw method", {
        shopId: req.seller.id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Admin fix shop profile
router.put(
  "/admin-fix-shop-profile/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { firstName, lastName } = req.body;
      if (!firstName || !lastName) {
        return next(new ErrorHandler("First and last name are required", 400));
      }
      const shop = await Shop.findById(req.params.id);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }
      shop.fullname = { firstName, lastName };
      await shop.save();
      logger.info("admin-fix-shop-profile: Shop profile updated", {
        shopId: req.params.id,
        adminId: req.user._id,
      });
      res.status(200).json({
        success: true,
        message: "Shop profile updated",
        shop,
      });
    } catch (error) {
      logger.error("admin-fix-shop-profile: Error updating shop profile", {
        shopId: req.params.id,
        adminId: req.user._id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Send message to shop (user to shop)
router.post(
  "/send-message-to-shop/:shopId",
  isAuthenticated,
  messageRateLimiter,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkSuspensionStatus(req.user.id);
      const { shopId } = req.params;
      const { content, media } = req.body;
      const senderId = req.user.id;

      if (!mongoose.isValidObjectId(shopId)) {
        return next(new ErrorHandler("Invalid shop ID", 400));
      }

      const shop = await Shop.findById(shopId);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }

      await checkShopStatus(shopId);
      await checkBlockStatus(senderId, shopId);

      if (!content && (!media || !Array.isArray(media) || media.length === 0)) {
        return next(
          new ErrorHandler("Message must contain either content or media", 400)
        );
      }

      const messageMedia = [];
      if (media && Array.isArray(media) && media.length > 0) {
        for (const item of media.slice(0, 4)) {
          if (!item.data || !["image", "video"].includes(item.type)) {
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
        senderModel: "User",
        receiverId: shopId,
        receiverModel: "Shop",
        content: content || "",
        media: messageMedia,
      });

      let conversation = await Conversation.findOne({
        members: { $all: [senderId, shopId] },
        isGroup: false,
        memberModel: "Shop",
      });

      if (!conversation) {
        conversation = await Conversation.create({
          members: [senderId, shopId],
          isGroup: false,
          memberModel: "Shop",
          lastMessage: content || `Sent ${messageMedia.length} media item(s)`,
          lastMessageId: message._id,
        });
      } else {
        conversation.lastMessage =
          content || `Sent ${messageMedia.length} media item(s)`;
        conversation.lastMessageId = message._id;
        conversation.isArchived = conversation.isArchived || {};
        conversation.isArchived.set(senderId.toString(), false);
        conversation.isArchived.set(shopId.toString(), false);
        await conversation.save();
      }

      const populatedMessage = await Message.findById(message._id)
        .populate("senderId", "username avatar")
        .populate("receiverId", "name avatar");

      const io = getIo();
      const shopSocketId = getReceiverSocketId(`shop_${shopId}`);
      const senderSocketId = getReceiverSocketId(senderId);
      if (shopSocketId) {
        io.to(shopSocketId).emit("newMessage", populatedMessage);
      }
      if (senderSocketId) {
        io.to(senderSocketId).emit("messageSent", populatedMessage);
      }

      if (shop.notificationPreferences.receiveMessageEmails) {
        const sender = await User.findById(senderId);
        await sendMessageNotification(shop, sender, content || `Media message`);
      }

      logger.info("send-message-to-shop: Message sent", {
        senderId,
        shopId,
        messageId: message._id,
        mediaCount: messageMedia.length,
      });

      res.status(201).json({
        success: true,
        message: populatedMessage,
      });
    } catch (error) {
      logger.error("send-message-to-shop: Error sending message", {
        senderId: req.user.id,
        shopId: req.params.shopId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Reply to user (shop to user)
router.post(
  "/reply-to-user/:userId",
  isSeller,
  messageRateLimiter,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkShopStatus(req.seller.id);
      const { userId } = req.params;
      const { content, media } = req.body;
      const senderId = req.seller.id;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      const user = await User.findById(userId);
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      await checkSuspensionStatus(userId);
      await checkBlockStatus(userId, senderId);

      if (!content && (!media || !Array.isArray(media) || media.length === 0)) {
        return next(
          new ErrorHandler("Message must contain either content or media", 400)
        );
      }

      const messageMedia = [];
      if (media && Array.isArray(media) && media.length > 0) {
        for (const item of media.slice(0, 4)) {
          if (!item.data || !["image", "video"].includes(item.type)) {
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
        senderModel: "Shop",
        receiverId: userId,
        receiverModel: "User",
        content: content || "",
        media: messageMedia,
      });

      let conversation = await Conversation.findOne({
        members: { $all: [senderId, userId] },
        isGroup: false,
        memberModel: "Shop",
      });

      if (!conversation) {
        conversation = await Conversation.create({
          members: [senderId, userId],
          isGroup: false,
          memberModel: "Shop",
          lastMessage: content || `Sent ${messageMedia.length} media item(s)`,
          lastMessageId: message._id,
        });
      } else {
        conversation.lastMessage =
          content || `Sent ${messageMedia.length} media item(s)`;
        conversation.lastMessageId = message._id;
        conversation.isArchived = conversation.isArchived || {};
        conversation.isArchived.set(senderId.toString(), false);
        conversation.isArchived.set(userId.toString(), false);
        await conversation.save();
      }

      const populatedMessage = await Message.findById(message._id)
        .populate("senderId", "name avatar")
        .populate("receiverId", "username avatar");

      const io = getIo();
      const userSocketId = getReceiverSocketId(userId);
      const senderSocketId = getReceiverSocketId(`shop_${senderId}`);
      if (userSocketId) {
        io.to(userSocketId).emit("newMessage", populatedMessage);
      }
      if (senderSocketId) {
        io.to(senderSocketId).emit("messageSent", populatedMessage);
      }

      if (user.notificationPreferences.receiveMessageEmails) {
        const sender = await Shop.findById(senderId);
        await sendMessageNotification(user, sender, content || `Media message`);
      }

      logger.info("reply-to-user: Message sent", {
        senderId,
        userId,
        messageId: message._id,
        mediaCount: messageMedia.length,
      });

      res.status(201).json({
        success: true,
        message: populatedMessage,
      });
    } catch (error) {
      logger.error("reply-to-user: Error sending message", {
        senderId: req.seller.id,
        userId: req.params.userId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get messages with user
router.get(
  "/get-messages-with-user/:userId",
  isSeller,
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkShopStatus(req.seller.id);
      const { userId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      const user = await User.findById(userId);
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      await checkSuspensionStatus(userId);
      await checkBlockStatus(userId, req.seller.id);

      const messages = await Message.find({
        $or: [
          {
            senderId: req.seller.id,
            senderModel: "Shop",
            receiverId: userId,
            receiverModel: "User",
          },
          {
            senderId: userId,
            senderModel: "User",
            receiverId: req.seller.id,
            receiverModel: "Shop",
          },
        ],
        isDeleted: false,
      })
        .populate("senderId", "name username avatar")
        .populate("receiverId", "name username avatar")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const totalMessages = await Message.countDocuments({
        $or: [
          {
            senderId: req.seller.id,
            senderModel: "Shop",
            receiverId: userId,
            receiverModel: "User",
          },
          {
            senderId: userId,
            senderModel: "User",
            receiverId: req.seller.id,
            receiverModel: "Shop",
          },
        ],
        isDeleted: false,
      });

      logger.info("get-messages-with-user: Messages retrieved successfully", {
        shopId: req.seller.id,
        userId,
        messageCount: messages.length,
      });

      res.status(200).json({
        success: true,
        messages,
        totalMessages,
        page: parseInt(page),
        totalPages: Math.ceil(totalMessages / limit),
      });
    } catch (error) {
      logger.error("get-messages-with-user: Error retrieving messages", {
        shopId: req.seller.id,
        userId: req.params.userId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Mark message as read
router.put(
  "/mark-message-read/:messageId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkShopStatus(req.seller.id);
      const { messageId } = req.params;

      if (!mongoose.isValidObjectId(messageId)) {
        return next(new ErrorHandler("Invalid message ID", 400));
      }

      const message = await Message.findById(messageId);
      if (!message) {
        return next(new ErrorHandler("Message not found", 404));
      }

      if (
        message.receiverId.toString() !== req.seller.id ||
        message.receiverModel !== "Shop"
      ) {
        return next(
          new ErrorHandler("Unauthorized to mark this message as read", 403)
        );
      }

      if (message.isRead) {
        return next(new ErrorHandler("Message already marked as read", 400));
      }

      message.isRead = true;
      await message.save();

      const populatedMessage = await Message.findById(message._id)
        .populate("senderId", "name username avatar")
        .populate("receiverId", "name username avatar");

      const io = getIo();
      const senderSocketId = getReceiverSocketId(
        message.senderModel === "Shop"
          ? `shop_${message.senderId}`
          : message.senderId
      );
      if (senderSocketId) {
        io.to(senderSocketId).emit("messageRead", { messageId: message._id });
      }

      logger.info("mark-message-read: Message marked as read", {
        messageId,
        shopId: req.seller.id,
      });

      res.status(200).json({
        success: true,
        message: populatedMessage,
      });
    } catch (error) {
      logger.error("mark-message-read: Error marking message as read", {
        messageId: req.params.messageId,
        shopId: req.seller.id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all shop conversations
router.get(
  "/get-conversations",
  isSeller,
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkShopStatus(req.seller.id);
      const { page = 1, limit = 20 } = req.query;

      const conversations = await Conversation.find({
        members: req.seller.id,
        isGroup: false,
        memberModel: "Shop",
        [`isArchived.${req.seller.id}`]: { $ne: true },
      })
        .populate("members", "username name avatar")
        .populate("lastMessageId", "content media createdAt isDeleted")
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const totalConversations = await Conversation.countDocuments({
        members: req.seller.id,
        isGroup: false,
        memberModel: "Shop",
        [`isArchived.${req.seller.id}`]: { $ne: true },
      });

      logger.info("get-conversations: Conversations retrieved successfully", {
        shopId: req.seller.id,
        conversationCount: conversations.length,
      });

      res.status(200).json({
        success: true,
        conversations,
        totalConversations,
        page: parseInt(page),
        totalPages: Math.ceil(totalConversations / limit),
      });
    } catch (error) {
      logger.error("get-conversations: Error retrieving conversations", {
        shopId: req.seller.id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Delete message
router.delete(
  "/delete-message/:messageId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkShopStatus(req.seller.id);
      const { messageId } = req.params;

      if (!mongoose.isValidObjectId(messageId)) {
        return next(new ErrorHandler("Invalid message ID", 400));
      }

      const message = await Message.findById(messageId);
      if (!message) {
        return next(new ErrorHandler("Message not found", 404));
      }

      if (
        (message.senderId.toString() !== req.seller.id ||
          message.senderModel !== "Shop") &&
        (message.receiverId.toString() !== req.seller.id ||
          message.receiverModel !== "Shop")
      ) {
        return next(
          new ErrorHandler("Unauthorized to delete this message", 403)
        );
      }

      if (message.isDeleted) {
        return next(new ErrorHandler("Message already deleted", 400));
      }

      message.isDeleted = true;
      message.deletedBy.push({ id: req.seller.id, model: "Shop" });
      await message.save();

      const conversation = await Conversation.findOne({
        lastMessageId: messageId,
        isGroup: false,
        memberModel: "Shop",
      });

      if (conversation) {
        const previousMessage = await Message.findOne({
          $or: [
            {
              senderId: conversation.members[0],
              receiverId: conversation.members[1],
            },
            {
              senderId: conversation.members[1],
              receiverId: conversation.members[0],
            },
          ],
          isDeleted: false,
        })
          .sort({ createdAt: -1 })
          .limit(1);

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

      const io = getIo();
      const otherPartyId =
        message.senderId.toString() === req.seller.id
          ? message.receiverId
          : message.senderId;
      const otherPartyModel =
        message.senderId.toString() === req.seller.id
          ? message.receiverModel
          : message.senderModel;
      const otherPartySocketId = getReceiverSocketId(
        otherPartyModel === "Shop" ? `shop_${otherPartyId}` : otherPartyId
      );
      if (otherPartySocketId) {
        io.to(otherPartySocketId).emit("messageDeleted", { messageId });
      }

      logger.info("delete-message: Message deleted successfully", {
        messageId,
        shopId: req.seller.id,
      });

      res.status(200).json({
        success: true,
        message: "Message deleted successfully",
      });
    } catch (error) {
      logger.error("delete-message: Error deleting message", {
        messageId: req.params.messageId,
        shopId: req.seller.id,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Archive conversation
router.put(
  "/archive-conversation/:userId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkShopStatus(req.seller.id);
      const { userId } = req.params;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      const user = await User.findById(userId);
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      const conversation = await Conversation.findOne({
        members: { $all: [req.seller.id, userId] },
        isGroup: false,
        memberModel: "Shop",
      });

      if (!conversation) {
        return next(new ErrorHandler("Conversation not found", 404));
      }

      conversation.isArchived = conversation.isArchived || {};
      conversation.isArchived.set(req.seller.id.toString(), true);
      await conversation.save();

      const io = getIo();
      const userSocketId = getReceiverSocketId(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("conversationArchived", {
          conversationId: conversation._id,
        });
      }

      logger.info("archive-conversation: Conversation archived successfully", {
        shopId: req.seller.id,
        userId,
        conversationId: conversation._id,
      });

      res.status(200).json({
        success: true,
        message: "Conversation archived successfully",
      });
    } catch (error) {
      logger.error("archive-conversation: Error archiving conversation", {
        shopId: req.seller.id,
        userId: req.params.userId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Unarchive conversation
router.put(
  "/unarchive-conversation/:userId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkShopStatus(req.seller.id);
      const { userId } = req.params;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      const user = await User.findById(userId);
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      const conversation = await Conversation.findOne({
        members: { $all: [req.seller.id, userId] },
        isGroup: false,
        memberModel: "Shop",
      });

      if (!conversation) {
        return next(new ErrorHandler("Conversation not found", 404));
      }

      conversation.isArchived = conversation.isArchived || {};
      conversation.isArchived.set(req.seller.id.toString(), false);
      await conversation.save();

      const io = getIo();
      const userSocketId = getReceiverSocketId(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("conversationUnarchived", {
          conversationId: conversation._id,
        });
      }

      logger.info(
        "unarchive-conversation: Conversation unarchived successfully",
        {
          shopId: req.seller.id,
          userId,
          conversationId: conversation._id,
        }
      );

      res.status(200).json({
        success: true,
        message: "Conversation unarchived successfully",
      });
    } catch (error) {
      logger.error("unarchive-conversation: Error unarchiving conversation", {
        shopId: req.seller.id,
        userId: req.params.userId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Block user
router.put(
  "/block-user/:userId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkShopStatus(req.seller.id);
      const { userId } = req.params;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      const user = await User.findById(userId);
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      await checkSuspensionStatus(userId);

      const shop = await Shop.findById(req.seller.id);
      if (!shop.blockedUsers) {
        shop.blockedUsers = [];
      }
      if (shop.blockedUsers.includes(userId)) {
        return next(new ErrorHandler("User already blocked", 400));
      }

      shop.blockedUsers.push(userId);
      await shop.save();

      const io = getIo();
      const userSocketId = getReceiverSocketId(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("blockedByShop", { shopId: req.seller.id });
      }

      logger.info("block-user: User blocked successfully", {
        shopId: req.seller.id,
        userId,
      });

      res.status(200).json({
        success: true,
        message: "User blocked successfully",
      });
    } catch (error) {
      logger.error("block-user: Error blocking user", {
        shopId: req.seller.id,
        userId: req.params.userId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Unblock user
router.put(
  "/unblock-user/:userId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      await checkShopStatus(req.seller.id);
      const { userId } = req.params;

      if (!mongoose.isValidObjectId(userId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      const user = await User.findById(userId);
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      const shop = await Shop.findById(req.seller.id);
      if (!shop.blockedUsers || !shop.blockedUsers.includes(userId)) {
        return next(new ErrorHandler("User not blocked", 400));
      }

      shop.blockedUsers = shop.blockedUsers.filter(
        (id) => id.toString() !== userId.toString()
      );
      await shop.save();

      const io = getIo();
      const userSocketId = getReceiverSocketId(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("unblockedByShop", { shopId: req.seller.id });
      }

      logger.info("unblock-user: User unblocked successfully", {
        shopId: req.seller.id,
        userId,
      });

      res.status(200).json({
        success: true,
        message: "User unblocked successfully",
      });
    } catch (error) {
      logger.error("unblock-user: Error unblocking user", {
        shopId: req.seller.id,
        userId: req.params.userId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Shop stats (assumed endpoint)
router.get(
  "/shop-stats/:shopId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { shopId } = req.params;
      if (!mongoose.isValidObjectId(shopId)) {
        return next(new ErrorHandler("Invalid shop ID", 400));
      }
      if (shopId !== req.seller.id.toString()) {
        return next(
          new ErrorHandler("Unauthorized to access this shop's stats", 403)
        );
      }

      const shop = await Shop.findById(shopId);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }

      const totalOrders = await Order.countDocuments({ shop: shopId });
      const pendingOrders = await Order.countDocuments({
        shop: shopId,
        status: "Pending",
      });
      const refundRequests = await Order.countDocuments({
        shop: shopId,
        status: "Refund Requested",
      });
      const recentOrders = await Order.countDocuments({
        shop: shopId,
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      });

      const stats = {
        totalSales: shop.availableBalance || 0,
        pendingOrders,
        refundRequests,
        totalOrders,
        recentOrders,
      };

      logger.info("shop-stats: Statistics retrieved", {
        shopId,
        stats,
      });

      res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      logger.error("shop-stats: Error retrieving shop stats", {
        shopId: req.params.shopId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all seller orders (assumed endpoint)
router.get(
  "/get-seller-all-orders/:shopId",
  isSeller,
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { shopId } = req.params;
      const { page = 1, limit = 5 } = req.query;
      if (!mongoose.isValidObjectId(shopId)) {
        return next(new ErrorHandler("Invalid shop ID", 400));
      }
      if (shopId !== req.seller.id.toString()) {
        return next(
          new ErrorHandler("Unauthorized to access this shop's orders", 403)
        );
      }

      const orders = await Order.find({ shop: shopId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .populate("customer", "username email");

      const orderCount = await Order.countDocuments({ shop: shopId });

      logger.info("get-seller-all-orders: Orders retrieved", {
        shopId,
        orderCount,
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        orders,
        totalOrders: orderCount,
        page: Number(page),
        pages: Math.ceil(orderCount / limit),
      });
    } catch (error) {
      logger.error("get-seller-all-orders: Error retrieving orders", {
        shopId: req.params.shopId,
        error: error.message,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
