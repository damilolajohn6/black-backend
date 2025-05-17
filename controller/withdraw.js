const express = require("express");
const mongoose = require("mongoose");
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
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { amount, withdrawMethod } = req.body;

      // Validate input
      if (!amount || amount < 10) {
        throw new ErrorHandler("Minimum withdrawal amount is $10", 400);
      }
      if (amount > 10000) {
        throw new ErrorHandler("Maximum withdrawal amount is $10,000", 400);
      }
      if (!withdrawMethod?.type || !withdrawMethod?.details) {
        throw new ErrorHandler("Withdrawal method is required", 400);
      }

      // Normalize withdrawMethod.type to match schema enum
      const validMethods = ["BankTransfer", "PayPal", "Other"];
      const normalizedMethodType = withdrawMethod.type
        ? validMethods.find(
            (method) =>
              method.toLowerCase() === withdrawMethod.type.toLowerCase()
          )
        : null;
      if (!normalizedMethodType) {
        throw new ErrorHandler(
          `Invalid withdrawal method type: ${
            withdrawMethod.type
          }. Must be one of ${validMethods.join(", ")}`,
          400
        );
      }

      // Validate shop
      const shop = await Shop.findById(req.seller._id).session(session);
      if (!shop) {
        throw new ErrorHandler("Shop not found", 404);
      }
      if (!shop.isVerified) {
        throw new ErrorHandler("Shop is not verified", 403);
      }
      if (shop.availableBalance < amount) {
        throw new ErrorHandler("Insufficient available balance", 400);
      }

      // Create withdrawal
      const withdrawData = {
        seller: shop._id,
        amount,
        withdrawMethod: {
          type: normalizedMethodType, // Use normalized type
          details: withdrawMethod.details,
        },
        statusHistory: [
          {
            status: "Processing",
            updatedAt: new Date(),
            reason: "Withdrawal request created",
          },
        ],
      };

      const withdraw = await Withdraw.create([withdrawData], { session });

      // Update shop balance and transactions
      shop.availableBalance -= amount;
      shop.pendingBalance += amount;
      shop.transactions.push({
        withdrawId: withdraw[0]._id,
        amount,
        type: "Withdrawal",
        status: "Processing",
        createdAt: new Date(),
        metadata: { withdrawMethod: normalizedMethodType },
      });
      await shop.save({ session });

      // Send email notification
      try {
        await sendMail({
          email: shop.email,
          subject: "Withdrawal Request Created",
          message: `Hello ${shop.name}, your withdrawal request of $${amount} via ${normalizedMethodType} is being processed. It will take 3-7 days to complete.`,
        });
      } catch (error) {
        console.error("Email send error:", {
          message: error.message,
          shopId: shop._id,
          withdrawId: withdraw[0]._id,
        });
        // Continue despite email failure
      }

      await session.commitTransaction();
      console.info("create-withdraw-request: Withdrawal created", {
        withdrawId: withdraw[0]._id,
        shopId: shop._id,
        amount,
        method: normalizedMethodType,
      });

      res.status(201).json({
        success: true,
        withdraw: withdraw[0],
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("create-withdraw-request error:", {
        message: error.message,
        shopId: req.seller?._id,
        amount: req.body.amount,
        withdrawMethod: req.body.withdrawMethod,
      });
      return next(new ErrorHandler(error.message, 400));
    } finally {
      session.endSession();
    }
  })
);

// Other routes remain unchanged
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

router.put(
  "/update-withdraw-request/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { status, reason } = req.body;

      // Validate status
      if (!["Approved", "Rejected", "Succeeded", "Failed"].includes(status)) {
        throw new ErrorHandler("Invalid status", 400);
      }
      if (["Rejected", "Failed"].includes(status) && !reason) {
        throw new ErrorHandler(
          "Reason is required for rejection or failure",
          400
        );
      }

      // Find withdrawal
      const withdraw = await Withdraw.findById(req.params.id)
        .populate("seller", "name email")
        .session(session);
      if (!withdraw) {
        throw new ErrorHandler("Withdrawal request not found", 404);
      }
      if (["Succeeded", "Failed"].includes(withdraw.status)) {
        throw new ErrorHandler("Withdrawal is already finalized", 400);
      }

      // Update withdrawal
      withdraw.status = status;
      withdraw.statusHistory.push({
        status,
        updatedAt: new Date(),
        reason: reason || "Status updated",
      });
      if (["Succeeded", "Failed"].includes(status)) {
        withdraw.processedAt = new Date();
      }

      // Update shop
      const shop = await Shop.findById(withdraw.seller._id).session(session);
      if (!shop) {
        throw new ErrorHandler("Shop not found", 404);
      }

      if (status === "Succeeded") {
        shop.pendingBalance = Math.max(
          0,
          (shop.pendingBalance || 0) - withdraw.amount
        );
      } else if (status === "Rejected" || status === "Failed") {
        shop.pendingBalance = Math.max(
          0,
          (shop.pendingBalance || 0) - withdraw.amount
        );
        shop.availableBalance = (shop.availableBalance || 0) + withdraw.amount;
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

      await withdraw.save({ session });
      await shop.save({ session });

      // Send email notification
      try {
        await sendMail({
          email: shop.email,
          subject: `Withdrawal Request ${status}`,
          message: `Hello ${shop.name}, your withdrawal request of $${
            withdraw.amount
          } via ${
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

      await session.commitTransaction();
      console.info("update-withdraw-request: Withdrawal updated", {
        withdrawId: withdraw._id,
        shopId: shop._id,
        status,
        availableBalance: shop.availableBalance,
        pendingBalance: shop.pendingBalance,
      });

      res.status(200).json({
        success: true,
        withdraw,
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("update-withdraw-request error:", {
        message: error.message,
        withdrawId: req.params.id,
      });
      return next(new ErrorHandler(error.message, 400));
    } finally {
      session.endSession();
    }
  })
);

module.exports = router;
