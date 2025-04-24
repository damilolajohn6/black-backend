const express = require("express");
const mongoose = require("mongoose"); // Add this import
const router = express.Router();
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isSeller, isAdmin } = require("../middleware/auth");
const Order = require("../model/order");
const Shop = require("../model/shop");
const Product = require("../model/product");

// Valid status transitions
const STATUS_TRANSITIONS = {
  Processing: ["Transferred to delivery partner", "Cancelled"],
  "Transferred to delivery partner": ["Shipped"],
  Shipped: ["Delivered"],
  Delivered: ["Refund Requested"],
  "Refund Requested": ["Refund Success", "Processing"],
  Cancelled: [],
  "Refund Success": [],
};

// Create new order
router.post(
  "/create-order",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { cart, shippingAddress, totalPrice, paymentInfo } = req.body;

      // Validate input
      if (!cart || !Array.isArray(cart) || cart.length === 0) {
        return next(
          new ErrorHandler("Cart is required and cannot be empty", 400)
        );
      }
      if (
        !shippingAddress ||
        !shippingAddress.address ||
        !shippingAddress.city ||
        !shippingAddress.country ||
        !shippingAddress.zipCode
      ) {
        return next(
          new ErrorHandler("Complete shipping address is required", 400)
        );
      }
      if (!totalPrice || totalPrice <= 0) {
        return next(new ErrorHandler("Valid total price is required", 400));
      }

      // Group cart items by shopId
      const shopItemsMap = new Map();
      let calculatedTotal = 0;

      for (const item of cart) {
        if (
          !item.productId ||
          !item.shopId ||
          !item.quantity ||
          item.quantity < 1
        ) {
          return next(
            new ErrorHandler(
              "Invalid cart item: productId, shopId, and quantity are required",
              400
            )
          );
        }

        // Fetch product and validate
        const product = await Product.findById(item.productId).select(
          "price stock shop"
        );
        if (!product) {
          return next(
            new ErrorHandler(`Product not found: ${item.productId}`, 404)
          );
        }
        if (product.shop.toString() !== item.shopId) {
          return next(
            new ErrorHandler(
              `Product ${item.productId} does not belong to shop ${item.shopId}`,
              400
            )
          );
        }
        if (product.stock < item.quantity) {
          return next(
            new ErrorHandler(
              `Insufficient stock for product: ${product.name}`,
              400
            )
          );
        }
        if (product.status !== "active") {
          return next(
            new ErrorHandler(`Product is not active: ${product.name}`, 400)
          );
        }

        const shopId = item.shopId;
        if (!shopItemsMap.has(shopId)) {
          shopItemsMap.set(shopId, []);
        }
        shopItemsMap.get(shopId).push({
          productId: item.productId,
          shop: item.shopId,
          quantity: item.quantity,
        });

        // Calculate total
        calculatedTotal +=
          (product.priceDiscount || product.price) * item.quantity;
      }

      // Validate totalPrice
      if (Math.abs(calculatedTotal - totalPrice) > 0.01) {
        return next(
          new ErrorHandler("Total price does not match cart items", 400)
        );
      }

      // Create orders per shop
      const orders = [];
      for (const [shopId, items] of shopItemsMap) {
        const shop = await Shop.findById(shopId);
        if (!shop) {
          return next(new ErrorHandler(`Shop not found: ${shopId}`, 404));
        }
        if (!shop.isVerified) {
          return next(new ErrorHandler(`Shop is not verified: ${shopId}`, 403));
        }

        const orderTotal = items.reduce((sum, item) => {
          const product = items.find(
            (i) => i.productId.toString() === item.productId.toString()
          );
          const prod = cart.find(
            (c) => c.productId === item.productId.toString()
          );
          return sum + (prod.priceDiscount || prod.price) * item.quantity;
        }, 0);

        const order = await Order.create({
          cart: items,
          shippingAddress,
          user: {
            _id: req.user._id,
            name: req.user.name,
            email: req.user.email,
          },
          totalPrice: orderTotal,
          paymentInfo,
          status: "Processing",
          statusHistory: [
            {
              status: "Processing",
              updatedBy: req.user._id,
              updatedByModel: "User",
              reason: "Order created",
            },
          ],
        });

        orders.push(order);
        console.info("create-order: Order created", {
          orderId: order._id,
          shopId,
          userId: req.user._id,
          totalPrice: orderTotal,
        });
      }

      res.status(201).json({
        success: true,
        orders,
      });
    } catch (error) {
      console.error("create-order error:", {
        message: error.message,
        body: req.body,
        userId: req.user?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    }
  })
);

// Get all orders of user
router.get(
  "/get-all-orders/:userId",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (
        req.user._id.toString() !== req.params.userId &&
        req.user.role !== "Admin"
      ) {
        return next(
          new ErrorHandler("Unauthorized to access these orders", 403)
        );
      }

      const orders = await Order.find({ "user._id": req.params.userId })
        .sort({ createdAt: -1 })
        .populate("cart.shop", "name email");

      console.info("get-all-orders: Orders retrieved", {
        userId: req.params.userId,
        orderCount: orders.length,
      });

      res.status(200).json({
        success: true,
        orders,
      });
    } catch (error) {
      console.error("get-all-orders error:", {
        message: error.message,
        userId: req.params.userId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get all orders of seller
router.get(
  "/get-seller-all-orders/:shopId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.seller._id.toString() !== req.params.shopId) {
        return next(
          new ErrorHandler("Unauthorized to access these orders", 403)
        );
      }

      const { status, page = 1, limit = 10, startDate, endDate } = req.query;
      const query = { "cart.shop": req.params.shopId };
      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const orders = await Order.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("cart.shop", "name email")
        .populate("user._id", "name email");

      const total = await Order.countDocuments(query);

      console.info("get-seller-all-orders: Orders retrieved", {
        shopId: req.params.shopId,
        orderCount: orders.length,
        page,
        limit,
        status,
        startDate,
        endDate,
      });

      res.status(200).json({
        success: true,
        orders,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("get-seller-all-orders error:", {
        message: error.message,
        shopId: req.params.shopId,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Update order status for seller
router.put(
  "/update-order-status/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { status } = req.body;
      const order = await Order.findById(req.params.id).populate("cart.shop");

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      // Verify seller owns the shop for this order
      const hasShop = order.cart.some(
        (item) => item.shop._id.toString() === req.seller._id.toString()
      );
      if (!hasShop) {
        return next(
          new ErrorHandler(
            "Unauthorized: Order does not belong to your shop",
            403
          )
        );
      }

      // Validate status transition
      if (!status || !STATUS_TRANSITIONS[order.status].includes(status)) {
        return next(
          new ErrorHandler(
            `Invalid status transition from ${order.status} to ${status}`,
            400
          )
        );
      }

      // Update product stock and sold_out
      if (status === "Transferred to delivery partner") {
        for (const item of order.cart) {
          const product = await Product.findById(item.productId);
          if (!product) {
            return next(
              new ErrorHandler(`Product not found: ${item.productId}`, 404)
            );
          }
          if (product.stock < item.quantity) {
            return next(
              new ErrorHandler(
                `Insufficient stock for product: ${product.name}`,
                400
              )
            );
          }
          product.stock -= item.quantity;
          product.sold_out += item.quantity;
          await product.save({ validateBeforeSave: false });
        }
      }

      // Update seller balance
      if (status === "Delivered") {
        const serviceCharge = order.totalPrice * 0.1;
        const sellerAmount = order.totalPrice - serviceCharge;
        const seller = await Shop.findById(req.seller._id);
        seller.pendingBalance += sellerAmount;
        await seller.save();
        order.deliveredAt = Date.now();
        order.paymentInfo.status = "Succeeded";
      }

      // Update status and history
      order.status = status;
      order.statusHistory.push({
        status,
        updatedBy: req.seller._id,
        updatedByModel: "Shop",
        reason: req.body.reason || `Status updated to ${status}`,
      });

      await order.save({ validateBeforeSave: false });

      console.info("update-order-status: Order updated", {
        orderId: order._id,
        shopId: req.seller._id,
        newStatus: status,
      });

      res.status(200).json({
        success: true,
        order,
      });
    } catch (error) {
      console.error("update-order-status error:", {
        message: error.message,
        orderId: req.params.id,
        shopId: req.seller?._id,
        status: req.body.status,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    }
  })
);

// Request refund (user)
router.put(
  "/order-refund/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { status, reason } = req.body;
      const order = await Order.findById(req.params.id);

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      if (order.user._id.toString() !== req.user._id.toString()) {
        return next(
          new ErrorHandler("Unauthorized to request refund for this order", 403)
        );
      }

      if (status !== "Refund Requested") {
        return next(new ErrorHandler("Invalid status for refund request", 400));
      }

      if (order.status !== "Delivered") {
        return next(
          new ErrorHandler(
            "Refunds can only be requested for delivered orders",
            400
          )
        );
      }

      if (!reason) {
        return next(new ErrorHandler("Refund reason is required", 400));
      }

      order.status = status;
      order.refundReason = reason;
      order.statusHistory.push({
        status,
        updatedBy: req.user._id,
        updatedByModel: "User",
        reason,
      });

      await order.save({ validateBeforeSave: false });

      console.info("order-refund: Refund requested", {
        orderId: order._id,
        userId: req.user._id,
        reason,
      });

      res.status(200).json({
        success: true,
        order,
        message: "Order refund request submitted successfully",
      });
    } catch (error) {
      console.error("order-refund error:", {
        message: error.message,
        orderId: req.params.id,
        userId: req.user?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    }
  })
);

// Accept refund (seller)
router.put(
  "/order-refund-success/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { status, reason } = req.body;
      const order = await Order.findById(req.params.id).populate("cart.shop");

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      // Verify seller owns the shop
      const hasShop = order.cart.some(
        (item) => item.shop._id.toString() === req.seller._id.toString()
      );
      if (!hasShop) {
        return next(
          new ErrorHandler(
            "Unauthorized: Order does not belong to your shop",
            403
          )
        );
      }

      if (status !== "Refund Success") {
        return next(
          new ErrorHandler("Invalid status for refund approval", 400)
        );
      }

      if (order.status !== "Refund Requested") {
        return next(
          new ErrorHandler("Order must be in 'Refund Requested' status", 400)
        );
      }

      // Restore product stock
      for (const item of order.cart) {
        const product = await Product.findById(item.productId);
        if (!product) {
          return next(
            new ErrorHandler(`Product not found: ${item.productId}`, 404)
          );
        }
        product.stock += item.quantity;
        product.sold_out -= item.quantity;
        await product.save({ validateBeforeSave: false });
      }

      // Update balance
      const seller = await Shop.findById(req.seller._id);
      seller.pendingBalance -= order.totalPrice;
      if (seller.pendingBalance < 0) {
        seller.pendingBalance = 0;
      }
      await seller.save();

      order.status = status;
      order.statusHistory.push({
        status,
        updatedBy: req.seller._id,
        updatedByModel: "Shop",
        reason: reason || "Refund approved",
      });

      await order.save();

      console.info("order-refund-success: Refund approved", {
        orderId: order._id,
        shopId: req.seller._id,
        reason,
      });

      res.status(200).json({
        success: true,
        message: "Order refund processed successfully",
      });
    } catch (error) {
      console.error("order-refund-success error:", {
        message: error.message,
        orderId: req.params.id,
        shopId: req.seller?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    }
  })
);

// Get all orders (admin)
router.get(
  "/admin-all-orders",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { page = 1, limit = 10, status } = req.query;
      const query = status ? { status } : {};

      const orders = await Order.find(query)
        .sort({ deliveredAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("cart.shop", "name email")
        .populate("user._id", "name email");

      const total = await Order.countDocuments(query);

      console.info("admin-all-orders: Orders retrieved", {
        orderCount: orders.length,
        page,
        limit,
        status,
      });

      res.status(201).json({
        success: true,
        orders,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("admin-all-orders error:", {
        message: error.message,
        query: req.query,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Get shop statistics
router.get(
  "/shop/stats/:shopId",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (req.seller._id.toString() !== req.params.shopId) {
        return next(
          new ErrorHandler("Unauthorized to access shop statistics", 403)
        );
      }

      const shopId = req.params.shopId;

      // Validate shopId as ObjectId
      if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return next(new ErrorHandler("Invalid shop ID", 400));
      }

      // Aggregate stats
      const stats = await Order.aggregate([
        { $match: { "cart.shop": new mongoose.Types.ObjectId(shopId) } },
        {
          $facet: {
            totalSales: [
              { $match: { status: { $in: ["Delivered", "Refund Success"] } } },
              { $group: { _id: null, total: { $sum: "$totalPrice" } } },
            ],
            pendingOrders: [
              {
                $match: {
                  status: {
                    $in: ["Processing", "Transferred to delivery partner"],
                  },
                },
              },
              { $count: "count" },
            ],
            totalOrders: [{ $count: "count" }],
            recentOrders: [
              {
                $match: {
                  createdAt: {
                    $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                  },
                },
              },
              { $count: "count" },
            ],
          },
        },
      ]);

      const result = {
        totalSales: stats[0].totalSales[0]?.total || 0,
        pendingOrders: stats[0].pendingOrders[0]?.count || 0,
        totalOrders: stats[0].totalOrders[0]?.count || 0,
        recentOrders: stats[0].recentOrders[0]?.count || 0,
      };

      console.info("shop-stats: Statistics retrieved", {
        shopId,
        stats: result,
      });

      res.status(200).json({
        success: true,
        stats: result,
      });
    } catch (error) {
      console.error("shop-stats error:", {
        message: error.message,
        shopId: req.params.shopId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
