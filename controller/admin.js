const express = require("express");
const { body } = require("express-validator");
const router = express.Router();
const Admin = require("../model/admin");
const sendMail = require("../utils/sendMail");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const cloudinary = require("cloudinary").v2;


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


// Send admin token
const sendAdminToken = (admin, statusCode, res, token) => {
  res.cookie("admin_token", token, {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  res.status(statusCode).json({
    success: true,
    admin,
    token,
  });
};

// Create admin (admin-only or initial setup)
router.post(
  "/create-admin",
  isAuthenticated,
  isAdmin("SuperAdmin"), // Restrict to SuperAdmin
  [
    body("email").isEmail().withMessage("Invalid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("fullname.firstName").notEmpty().withMessage("First name is required"),
    body("fullname.lastName").notEmpty().withMessage("Last name is required"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { fullname, email, password, role, permissions } = req.body;

      const existingAdmin = await Admin.findOne({ email });
      if (existingAdmin) {
        return next(
          new ErrorHandler("Admin with this email already exists", 400)
        );
      }

      const admin = {
        fullname,
        email,
        password,
        role: role || "Admin",
        permissions: permissions || [
          "manage_sellers",
          "manage_withdrawals",
          "view_reports",
        ],
        verificationOtp: Math.floor(100000 + Math.random() * 900000).toString(),
        verificationOtpExpiry: Date.now() + 10 * 60 * 1000,
        isVerified: false,
      };

      try {
        await sendMail({
          email: admin.email,
          subject: "Activate your admin account",
          message: `Hello ${admin.fullname.firstName}, your OTP to activate your admin account is ${admin.verificationOtp}. It expires in 10 minutes.`,
        });

        await Admin.create(admin);

        res.status(201).json({
          success: true,
          message: `Please check your email (${admin.email}) to activate your admin account with the OTP!`,
        });
      } catch (error) {
        console.error("CREATE ADMIN ERROR:", error);
        return next(new ErrorHandler(error.message, 500));
      }
    } catch (error) {
      console.error("CREATE ADMIN ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Activate admin
router.post(
  "/activation",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) {
        return next(new ErrorHandler("Email and OTP are required", 400));
      }
      const admin = await Admin.findOne({ email });
      if (!admin) {
        return next(new ErrorHandler("Admin not found", 400));
      }
      if (admin.isVerified) {
        return next(new ErrorHandler("Admin already verified", 400));
      }
      if (
        admin.verificationOtp !== otp ||
        admin.verificationOtpExpiry < Date.now()
      ) {
        return next(new ErrorHandler("Invalid or expired OTP", 400));
      }
      admin.isVerified = true;
      admin.verificationOtp = undefined;
      admin.verificationOtpExpiry = undefined;
      await admin.save();
      const token = admin.getJwtToken();
      sendAdminToken(admin, 201, res, token);
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Login admin
router.post(
  "/login-admin",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return next(new ErrorHandler("Please provide all fields!", 400));
      }
      const admin = await Admin.findOne({ email }).select("+password");
      if (!admin) {
        return next(new ErrorHandler("Admin doesn't exist!", 400));
      }
      if (!admin.isVerified) {
        return next(
          new ErrorHandler("Please verify your admin account first!", 400)
        );
      }
      const isPasswordValid = await admin.comparePassword(password);
      if (!isPasswordValid) {
        return next(new ErrorHandler("Invalid credentials", 400));
      }
      await admin.updateLastLogin();
      const token = admin.getJwtToken();
      sendAdminToken(admin, 201, res, token);
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Logout admin
router.get(
  "/logout",
  catchAsyncErrors(async (req, res, next) => {
    try {
      res.cookie("admin_token", null, {
        expires: new Date(Date.now()),
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
      res.status(200).json({
        success: true,
        message: "Admin logged out successfully",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get admin profile
router.get(
  "/get-admin",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const admin = await Admin.findById(req.admin.id);
      if (!admin) {
        return next(new ErrorHandler("Admin not found", 404));
      }
      res.status(200).json({
        success: true,
        admin,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update admin profile
router.put(
  "/update-admin",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { fullname, avatar } = req.body;
      const admin = await Admin.findById(req.admin.id);
      if (!admin) {
        return next(new ErrorHandler("Admin not found", 400));
      }
      if (fullname) {
        if (!fullname.firstName || !fullname.lastName) {
          return next(
            new ErrorHandler("First and last name are required", 400)
          );
        }
        admin.fullname = fullname;
      }
      if (avatar && avatar.url) {
        if (admin.avatar.public_id) {
          await cloudinary.v2.uploader.destroy(admin.avatar.public_id);
        }
        const myCloud = await cloudinary.v2.uploader.upload(avatar.url, {
          folder: "admin_avatars",
          width: 150,
        });
        admin.avatar = {
          public_id: myCloud.public_id,
          url: myCloud.secure_url,
        };
      }
      await admin.save();
      res.status(200).json({
        success: true,
        admin,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
