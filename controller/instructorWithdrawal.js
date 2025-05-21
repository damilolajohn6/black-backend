const express = require("express");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const Instructor = require("../model/instructor");
const InstructorWithdraw = require("../model/instructorWithdrawal");
const ErrorHandler = require("../utils/ErrorHandler");
const { isInstructor, isAuthenticated, isAdmin } = require("../middleware/auth");
const sendMail = require("../utils/sendMail");
const router = express.Router();

// Create withdraw request --- instructor only
router.post(
  "/create-instructor-withdraw-request",
  isInstructor,
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

      // Validate instructor
      const instructor = await Instructor.findById(req.instructor._id);
      if (!instructor) {
        return next(new ErrorHandler("Instructor not found", 404));
      }
      if (!instructor.isVerified) {
        return next(new ErrorHandler("Instructor is not verified", 403));
      }
      if (instructor.availableBalance < amount) {
        return next(new ErrorHandler("Insufficient available balance", 400));
      }

      // Create withdrawal
      const withdrawData = {
        instructor: instructor._id,
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

      const withdraw = await InstructorWithdraw.create(withdrawData);

      // Update instructor balance and transactions
      instructor.availableBalance -= amount;
      instructor.pendingBalance += amount;
      instructor.transactions.push({
        withdrawId: withdraw._id,
        amount,
        type: "Withdrawal",
        status: "Processing",
        createdAt: new Date(),
        metadata: { withdrawMethod: withdrawMethod.type },
      });
      await instructor.save();

      // Send email notification
      try {
        await sendMail({
          email: instructor.email,
          subject: "Withdrawal Request Created",
          message: `Hello ${instructor.fullname.firstName}, your withdrawal request of $${amount} via ${withdrawMethod.type} is being processed. It will take 3-7 days to complete.`,
        });
      } catch (error) {
        console.error("Email send error:", {
          message: error.message,
          instructorId: instructor._id,
          withdrawId: withdraw._id,
        });
        // Continue despite email failure
      }

      console.info("create-withdraw-request: Withdrawal created", {
        withdrawId: withdraw._id,
        instructorId: instructor._id,
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
        instructorId: req.instructor?._id,
        amount: req.body.amount,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all withdrawals --- instructor view
router.get(
  "/get-my-instructor-withdrawals",
  isInstructor,
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
      const query = { instructor: req.instructor._id };

      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const sort = {};
      sort[sortBy] = order === "desc" ? -1 : 1;

      const withdrawals = await InstructorWithdraw.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(Number(limit));

      const total = await InstructorWithdraw.countDocuments(query);

      console.info("get-my-withdrawals: Withdrawals retrieved", {
        instructorId: req.instructor._id,
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
        instructorId: req.instructor?._id,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all withdrawals --- admin view
router.get(
  "/get-all-instructor-withdraw-request",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      const query = status ? { status } : {};
      const withdrawals = await InstructorWithdraw.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("instructor", "name email");

      const total = await InstructorWithdraw.countDocuments(query);

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
  "/update-instructor-withdraw-request/:id",
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
      const withdraw = await InstructorWithdraw.findById(req.params.id).populate(
        "Instructor",
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

      // Update instructor
      const instructor = await Instructor.findById(withdraw.instructor._id);
      if (!instructor) {
        return next(new ErrorHandler("Instructor not found", 404));
      }

      if (status === "Succeeded") {
        instructor.pendingBalance -= withdraw.amount;
      } else if (status === "Rejected" || status === "Failed") {
        instructor.pendingBalance -= withdraw.amount;
        instructor.availableBalance += withdraw.amount;
      }

      // Update instructor transaction
      const transaction = instructor.transactions.find(
        (t) => t.withdrawId?.toString() === withdraw._id.toString()
      );
      if (transaction) {
        transaction.status = status;
        transaction.updatedAt = new Date();
        if (reason) transaction.metadata.reason = reason;
      }

      await instructor.save();

      // Send email notification
      try {
        await sendMail({
          email: instructor.email,
          subject: `Withdrawal Request ${status}`,
          message: `Hello ${
            instructor.fullname.firstName
          }, your withdrawal request of $${withdraw.amount} via ${
            withdraw.withdrawMethod.type
          } has been ${status.toLowerCase()}. ${
            reason ? `Reason: ${reason}` : "It will take 3-7 days to process."
          }`,
        });
      } catch (error) {
        console.error("Email send error:", {
          message: error.message,
          instructorId: instructor._id,
          withdrawId: withdraw._id,
        });
        // Continue despite email failure
      }

      console.info("update-withdraw-request: Withdrawal updated", {
        withdrawId: withdraw._id,
        instructorId: instructor._id,
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
