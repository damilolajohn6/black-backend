const express = require("express");
const { body } = require("express-validator");
const router = express.Router();
const Instructor = require("../model/instructor");
const sendMail = require("../utils/sendMail");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const {
  isAuthenticated,
  isAdmin,
  isInstructor,
} = require("../middleware/auth");
const cloudinary = require("cloudinary").v2;
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for form-data parsing
const upload = multer({ storage: multer.memoryStorage() });

const sendInstructorToken = (instructor, statusCode, res, token) => {
  console.debug("sendInstructorToken called:", {
    email: instructor.email,
    token,
  });

  const cookieExpiresDays = parseInt(process.env.JWT_COOKIE_EXPIRES, 10) || 7;
  const expires = new Date(
    Date.now() + cookieExpiresDays * 24 * 60 * 60 * 1000
  );

  if (isNaN(expires.getTime())) {
    console.error("Invalid cookie expiration date:", { cookieExpiresDays });
    return res.status(500).json({
      success: false,
      message: "Internal server error: Invalid cookie expiration",
    });
  }

  res.cookie("instructor_token", token, {
    expires,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  res.status(statusCode).json({
    success: true,
    instructor,
    token,
  });
};

// Create instructor
router.post(
  "/create-instructor",
  upload.none(),
  [
    body("email").isEmail().withMessage("Invalid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("fullname.firstName").notEmpty().withMessage("First name is required"),
    body("fullname.lastName").notEmpty().withMessage("Last name is required"),
    body("phoneNumber.countryCode")
      .matches(/^\+\d{1,3}$/)
      .withMessage("Invalid country code (e.g., +1, +44)")
      .notEmpty()
      .withMessage("Phone country code is required"),
    body("phoneNumber.number")
      .matches(/^\d{7,15}$/)
      .withMessage("Phone number must be 7-15 digits")
      .notEmpty()
      .withMessage("Phone number is required"),
    body("bio")
      .optional()
      .isLength({ max: 1000 })
      .withMessage("Bio cannot exceed 1000 characters"),
    body("expertise")
      .optional()
      .isArray()
      .withMessage("Expertise must be an array")
      .custom((value) =>
        value.every((item) => typeof item === "string" && item.length <= 50)
      )
      .withMessage(
        "Expertise items must be strings and cannot exceed 50 characters"
      ),
    body("socialLinks.website")
      .optional()
      .isURL()
      .withMessage("Invalid website URL"),
    body("socialLinks.linkedin")
      .optional()
      .isURL()
      .withMessage("Invalid LinkedIn URL"),
    body("socialLinks.twitter")
      .optional()
      .isURL()
      .withMessage("Invalid Twitter URL"),
    body("avatar.public_id")
      .optional()
      .isString()
      .withMessage("Avatar public_id must be a string"),
    body("avatar.url").optional().isURL().withMessage("Invalid avatar URL"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      console.debug("Received request body:", req.body);

      let {
        fullname,
        email,
        password,
        bio,
        expertise,
        avatar,
        phoneNumber,
        socialLinks,
      } = req.body;

      // Parse JSON strings from FormData
      const parseJsonField = (field, fieldName) => {
        if (typeof field === "string" && field.trim()) {
          try {
            return JSON.parse(field);
          } catch (error) {
            console.error(`${fieldName} JSON parse error:`, error);
            return next(new ErrorHandler(`Invalid ${fieldName} data`, 400));
          }
        }
        return field;
      };

      fullname = parseJsonField(fullname, "Fullname") || {};
      phoneNumber = parseJsonField(phoneNumber, "PhoneNumber") || {};
      expertise = parseJsonField(expertise, "Expertise") || [];
      socialLinks = parseJsonField(socialLinks, "SocialLinks") || {};
      avatar = parseJsonField(avatar, "Avatar") || {};

      console.debug("Parsed fields:", {
        fullname,
        phoneNumber,
        expertise,
        socialLinks,
        avatar,
      });

      const existingInstructor = await Instructor.findOne({ email });
      if (existingInstructor) {
        return next(
          new ErrorHandler("Instructor with this email already exists", 400)
        );
      }

      // Handle avatar
      let avatarData = {};
      if (avatar.public_id && avatar.url) {
        avatarData = {
          public_id: avatar.public_id,
          url: avatar.url,
        };
      } else {
        console.debug(
          "No valid avatar data provided, proceeding without avatar"
        );
      }

      const instructor = {
        fullname,
        email,
        password,
        phoneNumber,
        bio,
        expertise: expertise || [],
        avatar: Object.keys(avatarData).length > 0 ? avatarData : undefined,
        socialLinks: socialLinks || {},
        verificationOtp: Math.floor(100000 + Math.random() * 900000).toString(),
        verificationOtpExpiry: Date.now() + 10 * 60 * 1000,
        isVerified: false,
      };

      try {
        await sendMail({
          email: instructor.email,
          subject: "Activate your instructor account",
          message: `Hello ${instructor.fullname.firstName}, your OTP to activate your instructor account is ${instructor.verificationOtp}. It expires in 10 minutes.`,
        });

        console.debug("Attempting to create instructor:", { email });
        await Instructor.create(instructor);
        console.debug("Instructor created successfully:", { email });

        res.status(201).json({
          success: true,
          message: `Please check your email (${instructor.email}) to activate your instructor account with the OTP!`,
        });
      } catch (error) {
        console.error("CREATE INSTRUCTOR ERROR:", {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
        if (avatarData.public_id) {
          await cloudinary.uploader.destroy(avatarData.public_id);
        }
        if (error.name === "ValidationError") {
          console.debug("Validation error detected, returning 400");
          return next(new ErrorHandler(error.message, 400));
        }
        return next(new ErrorHandler(error.message, 500));
      }
    } catch (error) {
      console.error("CREATE INSTRUCTOR OUTER ERROR:", error);
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Instructor activation
router.post(
  "/instructor-activation",
  [
    body("email").isEmail().withMessage("Invalid email"),
    body("otp").notEmpty().withMessage("OTP is required"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, otp } = req.body;
      console.debug("Activation attempt:", { email, otp });

      const instructor = await Instructor.findOne({ email });
      if (!instructor) {
        return next(new ErrorHandler("Instructor not found", 400));
      }
      if (instructor.isVerified) {
        return next(new ErrorHandler("Instructor already verified", 400));
      }
      if (
        instructor.verificationOtp !== otp ||
        instructor.verificationOtpExpiry < Date.now()
      ) {
        return next(new ErrorHandler("Invalid or expired OTP", 400));
      }
      instructor.isVerified = true;
      instructor.verificationOtp = undefined;
      instructor.verificationOtpExpiry = undefined;
      await instructor.save();
      console.debug("Generating JWT token for activation:", { email });
      const token = instructor.getJwtToken();
      console.debug("JWT token generated for activation:", { token });
      sendInstructorToken(instructor, 201, res, token);
    } catch (error) {
      console.error("ACTIVATE INSTRUCTOR ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Resend OTP
router.post(
  "/resend-otp",
  [body("email").isEmail().withMessage("Invalid email")],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email } = req.body;
      const instructor = await Instructor.findOne({ email });
      if (!instructor) {
        return next(new ErrorHandler("Instructor not found", 404));
      }
      if (instructor.isVerified) {
        return next(new ErrorHandler("Instructor already verified", 400));
      }

      instructor.verificationOtp = Math.floor(
        100000 + Math.random() * 900000
      ).toString();
      instructor.verificationOtpExpiry = Date.now() + 10 * 60 * 1000;
      await instructor.save();

      try {
        await sendMail({
          email: instructor.email,
          subject: "Activate your instructor account",
          message: `Hello ${instructor.fullname.firstName}, your new OTP to activate your instructor account is ${instructor.verificationOtp}. It expires in 10 minutes.`,
        });

        console.info("resend-otp: OTP resent", { email });

        res.status(200).json({
          success: true,
          message: `New OTP sent to ${email}`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
        return next(new ErrorHandler("Failed to send OTP", 500));
      }
    } catch (error) {
      console.error("RESEND OTP ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Login instructor
router.post(
  "/login-instructor",
  [
    body("email").isEmail().withMessage("Invalid email"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password } = req.body;
      console.debug("Login attempt:", { email });

      const instructor = await Instructor.findOne({ email }).select(
        "+password"
      );
      if (!instructor) {
        console.debug("Instructor not found:", { email });
        return next(new ErrorHandler("Instructor doesn't exist!", 400));
      }
      if (!instructor.isVerified) {
        console.debug("Instructor not verified:", { email });
        return next(
          new ErrorHandler("Please verify your instructor account first!", 400)
        );
      }
      const isPasswordValid = await instructor.comparePassword(password);
      console.debug("Password validation result:", { isPasswordValid });
      if (!isPasswordValid) {
        console.debug("Invalid password for:", { email });
        return new ErrorHandler("Invalid credentials", 400);
      }
      console.debug("Generating JWT token for instructor:", { email });
      const token = instructor.getJwtToken();
      console.debug("JWT token generated:", { token });
      sendInstructorToken(instructor, 201, res, token);
    } catch (error) {
      console.error("LOGIN INSTRUCTOR ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Logout instructor
router.get(
  "/instructor-logout",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      res.cookie("instructor_token", null, {
        expires: new Date(Date.now()),
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
      res.status(200).json({
        success: true,
        message: "Instructor logged out successfully",
      });
    } catch (error) {
      console.error("LOGOUT INSTRUCTOR ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get instructor
router.get(
  "/get-instructor",
  isInstructor,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const instructor = await Instructor.findById(req.instructor._id);
      res.status(200).json({
        success: true,
        instructor,
      });
    } catch (error) {
      console.error("GET INSTRUCTOR ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update instructor
router.put(
  "/update-instructor",
  isInstructor,
  [
    body("fullname.firstName")
      .optional()
      .notEmpty()
      .withMessage("First name is required"),
    body("fullname.lastName")
      .optional()
      .notEmpty()
      .withMessage("Last name is required"),
    body("bio")
      .optional()
      .isLength({ max: 500 })
      .withMessage("Bio cannot exceed 500 characters"),
    body("expertise")
      .optional()
      .isArray()
      .withMessage("Expertise must be an array")
      .custom((value) =>
        value.every((item) => typeof item === "string" && item.length <= 50)
      )
      .withMessage(
        "Expertise items must be strings and cannot exceed 50 characters"
      ),
    body("socialLinks.website")
      .optional()
      .isURL()
      .withMessage("Invalid website URL"),
    body("socialLinks.linkedin")
      .optional()
      .isURL()
      .withMessage("Invalid LinkedIn URL"),
    body("socialLinks.twitter")
      .optional()
      .isURL()
      .withMessage("Invalid Twitter URL"),
    body("avatar.url").optional().isURL().withMessage("Invalid avatar URL"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { fullname, bio, expertise, socialLinks, avatar } = req.body;
      const instructor = await Instructor.findById(req.instructor._id);
      if (!instructor) {
        return next(new ErrorHandler("Instructor not found", 400));
      }
      if (fullname) {
        if (!fullname.firstName || !fullname.lastName) {
          return next(
            new ErrorHandler("First and last name are required", 400)
          );
        }
        instructor.fullname = fullname;
      }
      if (bio) instructor.bio = bio;
      if (expertise) instructor.expertise = expertise;
      if (socialLinks) instructor.socialLinks = socialLinks;
      if (avatar && avatar.url) {
        if (instructor.avatar.public_id) {
          await cloudinary.uploader.destroy(instructor.avatar.public_id);
        }
        const myCloud = await cloudinary.uploader.upload(avatar.url, {
          folder: "instructor_avatars",
          width: 150,
        });
        instructor.avatar = {
          public_id: myCloud.public_id,
          url: myCloud.secure_url,
        };
      }
      await instructor.save();
      res.status(200).json({
        success: true,
        instructor,
      });
    } catch (error) {
      console.error("UPDATE INSTRUCTOR ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Approve instructor
router.put(
  "/approve-instructor/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { isInstructorApproved, approvalReason } = req.body;
      const instructor = await Instructor.findById(req.params.id);
      if (!instructor) {
        return next(new ErrorHandler("Instructor not found", 404));
      }
      instructor.approvalStatus.isInstructorApproved = isInstructorApproved;
      instructor.approvalStatus.approvalReason = approvalReason || "";
      if (isInstructorApproved) {
        instructor.approvalStatus.approvedAt = new Date();
      }
      await instructor.save();

      try {
        await sendMail({
          email: instructor.email,
          subject: `Instructor Account ${
            isInstructorApproved ? "Approved" : "Rejected"
          }`,
          message: `Hello ${
            instructor.fullname.firstName
          }, your instructor account has been ${
            isInstructorApproved ? "approved" : "rejected"
          }. ${approvalReason ? `Reason: ${approvalReason}` : ""}`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
      }

      console.info("approve-instructor: Instructor approval updated", {
        instructorId: req.params.id,
        isInstructorApproved,
      });

      res.status(200).json({
        success: true,
        instructor,
      });
    } catch (error) {
      console.error("APPROVE INSTRUCTOR ERROR:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Forgot password
router.post(
  "/forgot-password",
  [body("email").isEmail().withMessage("Invalid email")],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email } = req.body;

      const instructor = await Instructor.findOne({ email });
      if (!instructor) {
        return next(new ErrorHandler("Instructor not found", 404));
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      instructor.passwordResetOtp = otp;
      instructor.passwordResetOtpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
      await instructor.save();

      try {
        await sendMail({
          email: instructor.email,
          subject: "Password Reset OTP",
          message: `Hello ${instructor.fullname.firstName}, your OTP to reset your password is ${otp}. This OTP expires in 10 minutes.`,
        });

        console.info("forgot-password: Reset OTP sent", { email });

        res.status(200).json({
          success: true,
          message: `Password reset OTP sent to ${email}`,
        });
      } catch (error) {
        console.error("EMAIL SEND ERROR:", error);
        instructor.passwordResetOtp = undefined;
        instructor.passwordResetOtpExpiry = undefined;
        await instructor.save();
        return next(new ErrorHandler("Failed to send reset OTP", 500));
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
  [
    body("email").isEmail().withMessage("Invalid email"),
    body("otp").notEmpty().withMessage("OTP is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, otp, password } = req.body;

      const instructor = await Instructor.findOne({
        email,
        passwordResetOtp: otp,
        passwordResetOtpExpiry: { $gt: Date.now() },
      });

      if (!instructor) {
        return next(new ErrorHandler("Invalid or expired OTP", 400));
      }

      instructor.password = password;
      instructor.passwordResetOtp = undefined;
      instructor.passwordResetOtpExpiry = undefined;
      await instructor.save();

      console.info("reset-password: Password reset successful", {
        email: instructor.email,
      });

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

module.exports = router;
