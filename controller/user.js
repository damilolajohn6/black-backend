require("dotenv").config();
const express = require("express");
const User = require("../model/user");
const router = express.Router();
const cloudinary = require("cloudinary").v2;
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const sendMail = require("../utils/sendMail");
const sendToken = require("../utils/jwtToken");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const { body } = require("express-validator");
const multer = require("multer");
const Report = require("../model/report");
const { getIo, getReceiverSocketId } = require("../socketInstance");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Multer for in-memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new ErrorHandler("Only image files are allowed", 400), false);
    }
  },
});

// Create user
router.post(
  "/create-user",
  upload.single("avatar"),
  [
    body("email").isEmail().withMessage("Invalid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("fullname.firstName").notEmpty().withMessage("First name is required"),
    body("fullname.lastName").notEmpty().withMessage("Last name is required"),
    body("username")
      .notEmpty()
      .withMessage("Username is required")
      .matches(/^[a-zA-Z0-9_]{3,30}$/)
      .withMessage(
        "Username must be 3-30 characters, letters, numbers, or underscores"
      ),
    body("role")
      .isIn(["user", "seller", "instructor", "serviceProvider", "admin"])
      .withMessage("Invalid role"),
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
      // Parse JSON fields from FormData
      let fullname = {};
      let phone = {};
      try {
        if (req.body.fullname) {
          fullname = JSON.parse(req.body.fullname);
        }
        if (req.body.phone) {
          phone = JSON.parse(req.body.phone);
        }
      } catch (error) {
        console.error("JSON PARSE ERROR:", error);
        return next(
          new ErrorHandler("Invalid JSON format for fullname or phone", 400)
        );
      }
      const { username, email, password, role } = req.body;

      // Validate parsed fields
      if (!fullname.firstName || !fullname.lastName) {
        return next(new ErrorHandler("First and last name are required", 400));
      }

      const userEmail = await User.findOne({ email });
      if (userEmail) {
        return next(new ErrorHandler("User already exists", 400));
      }

      const userUsername = await User.findOne({ username });
      if (userUsername) {
        return next(new ErrorHandler("Username already exists", 400));
      }

      let avatarData = {};
      if (req.file) {
        try {
          const myCloud = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                folder: "avatars",
                width: 150,
                crop: "scale",
                resource_type: "image",
              },
              (error, result) => {
                if (error) {
                  console.error("CLOUDINARY UPLOAD ERROR:", error);
                  reject(new ErrorHandler("Failed to upload avatar", 500));
                } else {
                  resolve(result);
                }
              }
            );
            uploadStream.end(req.file.buffer);
          });

          avatarData = {
            public_id: myCloud.public_id,
            url: myCloud.secure_url,
          };
        } catch (error) {
          console.error("CLOUDINARY UPLOAD ERROR:", error);
          return next(new ErrorHandler("Failed to upload avatar", 500));
        }
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = Date.now() + 10 * 60 * 1000;

      const user = {
        fullname,
        username,
        email,
        password,
        phoneNumber:
          phone.countryCode && phone.number
            ? { countryCode: phone.countryCode, number: phone.number }
            : undefined,
        avatar: avatarData,
        role: role || "user",
        verificationOtp: otp,
        verificationOtpExpiry: otpExpiry,
        isVerified: false,
      };

      try {
        await sendMail({
          email: user.email,
          subject: "Activate your account",
          message: `Hello ${user.fullname.firstName}, your OTP to activate your account is ${otp}. It expires in 10 minutes.`,
        });

        await User.create(user);

        res.status(201).json({
          success: true,
          message: `Please check your email (${user.email}) to activate your account with the OTP!`,
        });
      } catch (error) {
        console.error("CREATE USER ERROR:", error);
        if (avatarData.public_id) {
          await cloudinary.uploader.destroy(avatarData.public_id);
        }
        return next(new ErrorHandler(error.message, 500));
      }
    } catch (error) {
      console.error("CREATE USER ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
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

      const user = await User.findOne({ email });

      if (!user) {
        return next(new ErrorHandler("User not found", 400));
      }

      if (user.isVerified) {
        return next(new ErrorHandler("User already verified", 400));
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = Date.now() + 10 * 60 * 1000;

      user.verificationOtp = otp;
      user.verificationOtpExpiry = otpExpiry;
      await user.save();

      try {
        await sendMail({
          email: user.email,
          subject: "Activate your account - New OTP",
          message: `Hello ${user.fullname.firstName}, your new OTP to activate your account is ${otp}. It expires in 10 minutes.`,
        });

        res.status(200).json({
          success: true,
          message: `A new OTP has been sent to ${user.email}.`,
        });
      } catch (error) {
        console.error("RESEND OTP ERROR:", error);
        return next(new ErrorHandler("Failed to send OTP email", 500));
      }
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Activate user
router.post(
  "/activation",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return next(new ErrorHandler("Email and OTP are required", 400));
      }

      const user = await User.findOne({ email });

      if (!user) {
        return next(new ErrorHandler("User not found", 400));
      }

      if (user.isVerified) {
        return next(new ErrorHandler("User already verified", 400));
      }

      if (
        user.verificationOtp !== otp ||
        user.verificationOtpExpiry < Date.now()
      ) {
        return next(new ErrorHandler("Invalid or expired OTP", 400));
      }

      user.isVerified = true;
      user.verificationOtp = undefined;
      user.verificationOtpExpiry = undefined;
      await user.save();

      sendToken(user, 201, res);
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Login user
router.post(
  "/login-user",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return next(new ErrorHandler("Please provide all fields!", 400));
      }

      const user = await User.findOne({ email }).select("+password");

      if (!user) {
        return next(new ErrorHandler("User doesn't exist!", 400));
      }

      if (!user.isVerified) {
        return next(new ErrorHandler("Please verify your account first!", 400));
      }

      const isPasswordValid = await user.comparePassword(password);

      if (!isPasswordValid) {
        return next(new ErrorHandler("Invalid credentials", 400));
      }

      sendToken(user, 201, res);
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Forgot password - Request OTP
router.post(
  "/forgot-password",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email } = req.body;

      if (!email) {
        return next(new ErrorHandler("Email is required", 400));
      }

      const user = await User.findOne({ email });

      if (!user) {
        return next(new ErrorHandler("User not found", 400));
      }

      const otp = user.createPasswordResetOtp();
      await user.save();

      try {
        await sendMail({
          email: user.email,
          subject: "Reset Your Password",
          message: `Hello ${user.fullname.firstName}, your OTP to reset your password is ${otp}. It expires in 10 minutes.`,
        });

        res.status(200).json({
          success: true,
          message: `A password reset OTP has been sent to ${user.email}.`,
        });
      } catch (error) {
        console.error("FORGOT PASSWORD EMAIL ERROR:", error);
        return next(new ErrorHandler("Failed to send OTP email", 500));
      }
    } catch (error) {
      console.error("FORGOT PASSWORD ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Reset password
router.post(
  "/reset-password",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, otp, newPassword, confirmPassword } = req.body;

      if (!email || !otp || !newPassword || !confirmPassword) {
        return next(new ErrorHandler("All fields are required", 400));
      }

      if (newPassword !== confirmPassword) {
        return next(new ErrorHandler("Passwords do not match", 400));
      }

      if (newPassword.length < 6) {
        return next(
          new ErrorHandler("Password must be at least 6 characters", 400)
        );
      }

      const user = await User.findOne({ email }).select("+password");

      if (!user) {
        return next(new ErrorHandler("User not found", 400));
      }

      if (
        user.resetPasswordOtp !== otp ||
        user.resetPasswordOtpExpiry < Date.now()
      ) {
        return next(new ErrorHandler("Invalid or expired OTP", 400));
      }

      user.password = newPassword;
      user.resetPasswordOtp = undefined;
      user.resetPasswordOtpExpiry = undefined;
      await user.save();

      res.status(200).json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      console.error("RESET PASSWORD ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Load user
router.get(
  "/getuser",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return next(new ErrorHandler("User doesn't exist", 400));
      }

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Log out user
router.get(
  "/logout",
  catchAsyncErrors(async (req, res, next) => {
    try {
      res.cookie("token", null, {
        expires: new Date(Date.now()),
        httpOnly: true,
        sameSite: "none",
        secure: true,
      });
      res.status(201).json({
        success: true,
        message: "Log out successful!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update user info
router.put(
  "/update-user-info",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password, phoneNumber, username } = req.body;

      const user = await User.findOne({ email }).select("+password");

      if (!user) {
        return next(new ErrorHandler("User not found", 400));
      }

      const isPasswordValid = await user.comparePassword(password);

      if (!isPasswordValid) {
        return next(new ErrorHandler("Invalid credentials", 400));
      }

      user.username = username || user.username;
      user.email = email || user.email;
      user.phoneNumber = phoneNumber || user.phoneNumber;

      await user.save();

      res.status(201).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update user avatar
router.put(
  "/update-avatar",
  isAuthenticated,
  upload.single("avatar"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      let user = await User.findById(req.user.id);
      let avatarData = user.avatar || {};

      if (req.file) {
        // Delete existing avatar if present
        if (user.avatar?.public_id) {
          await cloudinary.uploader.destroy(user.avatar.public_id);
        }

        // Upload new avatar
        const myCloud = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: "avatars",
              width: 150,
              crop: "scale",
              resource_type: "image",
            },
            (error, result) => {
              if (error) {
                console.error("CLOUDINARY UPLOAD ERROR:", error);
                reject(new ErrorHandler("Failed to upload avatar", 500));
              } else {
                resolve(result);
              }
            }
          );
          uploadStream.end(req.file.buffer);
        });

        avatarData = {
          public_id: myCloud.public_id,
          url: myCloud.secure_url,
        };
        user.avatar = avatarData;
      }

      await user.save();

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      console.error("UPDATE AVATAR ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update user addresses
router.put(
  "/update-user-addresses",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      const sameTypeAddress = user.addresses.find(
        (address) => address.addressType === req.body.addressType
      );
      if (sameTypeAddress) {
        return next(
          new ErrorHandler(
            `${req.body.addressType} address already exists`,
            400
          )
        );
      }

      const existsAddress = user.addresses.find(
        (address) => address._id === req.body._id
      );

      if (existsAddress) {
        Object.assign(existsAddress, req.body);
      } else {
        user.addresses.push(req.body);
      }

      await user.save();

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Delete user address
router.delete(
  "/delete-user-address/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const userId = req.user._id;
      const addressId = req.params.id;

      await User.updateOne(
        { _id: userId },
        { $pull: { addresses: { _id: addressId } } }
      );

      const user = await User.findById(userId);

      res.status(200).json({ success: true, user });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update user password
router.put(
  "/update-user-password",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id).select("+password");

      const isPasswordMatched = await user.comparePassword(
        req.body.oldPassword
      );

      if (!isPasswordMatched) {
        return next(new ErrorHandler("Old password is incorrect!", 400));
      }

      if (req.body.newPassword !== req.body.confirmPassword) {
        return next(new ErrorHandler("Passwords don't match!", 400));
      }
      user.password = req.body.newPassword;

      await user.save();

      res.status(200).json({
        success: true,
        message: "Password updated successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Find user information
router.get(
  "/user-info/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);

      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      console.error("USER INFO ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// All users --- admin
router.get(
  "/admin-all-users",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const users = await User.find().sort({ createdAt: -1 });
      res.status(201).json({
        success: true,
        users,
      });
    } catch (error) {
      console.error("ADMIN ALL USERS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Delete user --- admin
router.delete(
  "/delete-user/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);

      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      if (user.avatar.public_id) {
        await cloudinary.uploader.destroy(user.avatar.public_id);
      }

      await User.findByIdAndDelete(req.params.id);

      console.info("delete-user: User deleted", { userId: req.params.id });

      res.status(201).json({
        success: true,
        message: "User deleted successfully!",
      });
    } catch (error) {
      console.error("DELETE USER ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Report user
router.post(
  "/report-user/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { reason } = req.body;
      const reportedUserId = req.params.id;
      const reporterId = req.user.id;

      if (!mongoose.isValidObjectId(reportedUserId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      if (!reason || reason.length > 500) {
        return next(
          new ErrorHandler(
            "Report reason is required and must be 500 characters or less",
            400
          )
        );
      }

      if (reportedUserId === reporterId) {
        return next(new ErrorHandler("Cannot report yourself", 400));
      }

      const reportedUser = await User.findById(reportedUserId);
      if (!reportedUser) {
        return next(new ErrorHandler("User not found", 404));
      }

      const existingReport = await Report.findOne({
        user: reporterId,
        reportedUser: reportedUserId,
      });
      if (existingReport) {
        return next(
          new ErrorHandler("You have already reported this user", 400)
        );
      }

      await Report.create({
        user: reporterId,
        reportedUser: reportedUserId,
        reason,
      });

      console.info("report-user: User reported", {
        reporterId,
        reportedUserId,
        reason: reason.substring(0, 50),
      });

      res.status(201).json({
        success: true,
        message: "User reported successfully",
      });
    } catch (error) {
      console.error("REPORT USER ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Block user
router.post(
  "/block-user/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const userToBlockId = req.params.id;
      const blockerId = req.user.id;

      if (!mongoose.isValidObjectId(userToBlockId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      if (userToBlockId === blockerId) {
        return next(new ErrorHandler("Cannot block yourself", 400));
      }

      const userToBlock = await User.findById(userToBlockId);
      if (!userToBlock) {
        return next(new ErrorHandler("User not found", 404));
      }

      const blocker = await User.findById(blockerId);
      if (blocker.blockedUsers.includes(userToBlockId)) {
        return next(new ErrorHandler("User already blocked", 400));
      }

      blocker.blockedUsers.push(userToBlockId);
      await blocker.save();

      const io = getIo();
      const blockedUserSocketId = getReceiverSocketId(userToBlockId);
      if (blockedUserSocketId) {
        io.to(blockedUserSocketId).emit("userBlocked", {
          blockerId,
          blockedUserId: userToBlockId,
        });
      }

      console.info("block-user: User blocked", {
        blockerId,
        blockedUserId: userToBlockId,
      });

      res.status(200).json({
        success: true,
        message: `Blocked ${userToBlock.username}`,
      });
    } catch (error) {
      console.error("BLOCK USER ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Unblock user
router.post(
  "/unblock-user/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const userToUnblockId = req.params.id;
      const unblockerId = req.user.id;

      if (!mongoose.isValidObjectId(userToUnblockId)) {
        return next(new ErrorHandler("Invalid user ID", 400));
      }

      if (userToUnblockId === unblockerId) {
        return next(new ErrorHandler("Cannot unblock yourself", 400));
      }

      const userToUnblock = await User.findById(userToUnblockId);
      if (!userToUnblock) {
        return next(new ErrorHandler("User not found", 404));
      }

      const unblocker = await User.findById(unblockerId);
      if (!unblocker.blockedUsers.includes(userToUnblockId)) {
        return next(new ErrorHandler("User not blocked", 400));
      }

      unblocker.blockedUsers = unblocker.blockedUsers.filter(
        (id) => id.toString() !== userToUnblockId
      );
      await unblocker.save();

      const io = getIo();
      const unblockedUserSocketId = getReceiverSocketId(userToUnblockId);
      if (unblockedUserSocketId) {
        io.to(unblockedUserSocketId).emit("userUnblocked", {
          unblockerId,
          unblockedUserId: userToUnblockId,
        });
      }

      console.info("unblock-user: User unblocked", {
        unblockerId,
        unblockedUserId: userToUnblockId,
      });

      res.status(200).json({
        success: true,
        message: `Unblocked ${userToUnblock.username}`,
      });
    } catch (error) {
      console.error("UNBLOCK USER ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get blocked users
router.get(
  "/blocked-users",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id).populate(
        "blockedUsers",
        "username avatar"
      );

      res.status(200).json({
        success: true,
        blockedUsers: user.blockedUsers,
      });
    } catch (error) {
      console.error("GET BLOCKED USERS ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
