const jwt = require("jsonwebtoken");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("./catchAsyncErrors");
const User = require("../model/user");
const Shop = require("../model/shop");

exports.isAuthenticated = catchAsyncErrors(async (req, res, next) => {
  const { token } = req.cookies;
  if (!token) {
    return next(new ErrorHandler("Please login to continue", 401));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.user = await User.findById(decoded.id);
    if (!req.user) {
      return next(new ErrorHandler("User not found", 404));
    }
    console.debug("isAuthenticated: User authenticated", {
      userId: req.user._id,
    });
    next();
  } catch (error) {
    console.error("isAuthenticated error:", {
      message: error.message,
      token: token ? "present" : "missing",
    });
    return next(new ErrorHandler("Invalid or expired token", 401));
  }
});

exports.isSeller = catchAsyncErrors(async (req, res, next) => {
  let token = req.cookies.seller_token || req.headers.authorization?.split(" ")[1];
  if (!token) {
    console.error("isSeller: No seller token provided");
    return next(new ErrorHandler("Please login as a seller to continue", 401));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.seller = await Shop.findById(decoded.id);
    if (!req.seller) {
      console.error("isSeller: Shop not found for ID:", decoded.id);
      return next(new ErrorHandler("Seller not found", 404));
    }
    if (!req.seller.isVerified) {
      console.error("isSeller: Shop not verified for ID:", decoded.id);
      return next(new ErrorHandler("Please verify your shop account", 403));
    }
    console.debug("isSeller: Seller authenticated", {
      sellerId: req.seller._id,
      shopName: req.seller.name,
    });
    next();
  } catch (error) {
    console.error("isSeller error:", {
      message: error.message,
      token: token ? "present" : "missing",
    });
    return next(new ErrorHandler("Invalid or expired seller token", 401));
  }
});

exports.isAdmin = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return next(
        new ErrorHandler(
          `${req.user?.role || "User"} is not allowed to access this resource!`,
          403
        )
      );
    }
    console.debug("isAdmin: Admin access granted", {
      userId: req.user._id,
      role: req.user.role,
    });
    next();
  };
};