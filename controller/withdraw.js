const express = require("express");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const Shop = require("../model/shop");
const Withdraw = require("../model/withdraw");
const ErrorHandler = require("../utils/ErrorHandler");
const { isSeller, isAuthenticated, isAdmin } = require("../middleware/auth");
const sendMail = require("../utils/sendMail");
const router = express.Router();

// Create withdraw request --- seller only
router.post(
  "/create-withdraw-request",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { amount, withdrawMethod } = req.body;

      // Validate input
      if (!amount || amount < 10) {
        return next(new ErrorHandler("Minimum withdrawal amount is $10", 400));
      }
      if (amount > 10000) {
        return next(
          new ErrorHandler("Maximum withdrawal amount is $10,000", 400)
        );
      }
      if (!withdrawMethod?.type || !withdrawMethod?.details) {
        return next(new ErrorHandler("Withdrawal method is required", 400));
      }
      if (!["BankTransfer", "PayPal", "Other"].includes(withdrawMethod.type)) {
        return next(new ErrorHandler("Invalid withdrawal method type", 400));
      }

      // Validate shop
      const shop = await Shop.findById(req.seller._id);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }
      if (!shop.isVerified) {
        return next(new ErrorHandler("Shop is not verified", 403));
      }
      if (shop.availableBalance < amount) {
        return next(new ErrorHandler("Insufficient available balance", 400));
      }

      // Create withdrawal
      const withdrawData = {
        seller: shop._id,
        amount,
        withdrawMethod,
        statusHistory: [
          {
            status: "Processing",
            updatedAt: new Date(),
            reason: "Withdrawal request created",
          },
        ],
      };

      const withdraw = await Withdraw.create(withdrawData);

      // Update shop balance and transactions
      shop.availableBalance -= amount;
      shop.pendingBalance += amount;
      shop.transactions.push({
        withdrawId: withdraw._id,
        amount,
        type: "Withdrawal",
        status: "Processing",
        createdAt: new Date(),
        metadata: { withdrawMethod: withdrawMethod.type },
      });
      await shop.save();

      // Send email notification
      try {
        await sendMail({
          email: shop.email,
          subject: "Withdrawal Request Created",
          message: `Hello ${shop.name}, your withdrawal request of $${amount} via ${withdrawMethod.type} is being processed. It will take 3-7 days to complete.`,
        });
      } catch (error) {
        console.error("Email send error:", {
          message: error.message,
          shopId: shop._id,
          withdrawId: withdraw._id,
        });
        // Continue despite email failure
      }

      console.info("create-withdraw-request: Withdrawal created", {
        withdrawId: withdraw._id,
        shopId: shop._id,
        amount,
        method: withdrawMethod.type,
      });

      res.status(201).json({
        success: true,
        withdraw,
      });
    } catch (error) {
      console.error("create-withdraw-request error:", {
        message: error.message,
        shopId: req.seller?._id,
        amount: req.body.amount,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all withdrawals --- seller view
router.get(
  "/get-my-withdrawals",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const {
        status,
        startDate,
        endDate,
        page = 1,
        limit = 10,
        sortBy = "createdAt",
        order = "desc",
      } = req.query;
      const query = { seller: req.seller._id };

      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const sort = {};
      sort[sortBy] = order === "desc" ? -1 : 1;

      const withdrawals = await Withdraw.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const total = await Withdraw.countDocuments(query);

      console.info("get-my-withdrawals: Withdrawals retrieved", {
        shopId: req.seller._id,
        withdrawalCount: withdrawals.length,
        query,
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        withdrawals,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("get-my-withdrawals error:", {
        message: error.message,
        shopId: req.seller?._id,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all withdrawals --- admin view
router.get(
  "/get-all-withdraw-request",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      const query = status ? { status } : {};
      const withdrawals = await Withdraw.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("seller", "name email");

      const total = await Withdraw.countDocuments(query);

      console.info("get-all-withdraw-request: Withdrawals retrieved", {
        withdrawalCount: withdrawals.length,
        query,
        page,
        limit,
      });

      res.status(200).json({
        success: true,
        withdrawals,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("get-all-withdraw-request error:", {
        message: error.message,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update withdrawal request --- admin only
router.put(
  "/update-withdraw-request/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { status, reason } = req.body;

      // Validate status
      if (!["Approved", "Rejected", "Succeeded", "Failed"].includes(status)) {
        return next(new ErrorHandler("Invalid status", 400));
      }
      if (["Rejected", "Failed"].includes(status) && !reason) {
        return next(
          new ErrorHandler("Reason is required for rejection or failure", 400)
        );
      }

      // Find withdrawal
      const withdraw = await Withdraw.findById(req.params.id).populate(
        "seller",
        "name email"
      );
      if (!withdraw) {
        return next(new ErrorHandler("Withdrawal request not found", 404));
      }
      if (["Succeeded", "Failed"].includes(withdraw.status)) {
        return next(new ErrorHandler("Withdrawal is already finalized", 400));
      }

      // Update withdrawal
      withdraw.status = status;
      if (reason) {
        withdraw.statusHistory.push({
          status,
          updatedAt: new Date(),
          reason,
        });
      }
      await withdraw.save();

      // Update shop
      const shop = await Shop.findById(withdraw.seller._id);
      if (!shop) {
        return next(new ErrorHandler("Shop not found", 404));
      }

      if (status === "Succeeded") {
        shop.pendingBalance -= withdraw.amount;
      } else if (status === "Rejected" || status === "Failed") {
        shop.pendingBalance -= withdraw.amount;
        shop.availableBalance += withdraw.amount;
      }

      // Update shop transaction
      const transaction = shop.transactions.find(
        (t) => t.withdrawId?.toString() === withdraw._id.toString()
      );
      if (transaction) {
        transaction.status = status;
        transaction.updatedAt = new Date();
        if (reason) transaction.metadata.reason = reason;
      }

      await shop.save();

      // Send email notification
      try {
        await sendMail({
          email: shop.email,
          subject: `Withdrawal Request ${status}`,
          message: `Hello ${
            shop.name
          }, your withdrawal request of $${withdraw.amount} via ${
            withdraw.withdrawMethod.type
          } has been ${status.toLowerCase()}. ${
            reason ? `Reason: ${reason}` : "It will take 3-7 days to process."
          }`,
        });
      } catch (error) {
        console.error("Email send error:", {
          message: error.message,
          shopId: shop._id,
          withdrawId: withdraw._id,
        });
        // Continue despite email failure
      }

      console.info("update-withdraw-request: Withdrawal updated", {
        withdrawId: withdraw._id,
        shopId: shop._id,
        status,
      });

      res.status(200).json({
        success: true,
        withdraw,
      });
    } catch (error) {
      console.error("update-withdraw-request error:", {
        message: error.message,
        withdrawId: req.params.id,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

module.exports = router;
