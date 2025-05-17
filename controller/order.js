const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isSeller, isAdmin } = require("../middleware/auth");
const Order = require("../model/order");
const Shop = require("../model/shop");
const Product = require("../model/product");
const sendMail = require("../utils/sendMail");

// Valid status transitions aligned with schema
const STATUS_TRANSITIONS = {
  Pending: ["Confirmed", "Cancelled"],
  Confirmed: ["Shipped", "Cancelled"],
  Shipped: ["Delivered"],
  Delivered: ["Refunded"],
  Cancelled: [],
  Refunded: [],
};

// Create new order
router.post(
  "/create-order",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { items, shippingAddress, totalAmount, paymentInfo } = req.body;

      // Validate input
      if (!items || !Array.isArray(items) || items.length === 0) {
        return next(
          new ErrorHandler("Items array is required and cannot be empty", 400)
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
      if (!totalAmount || totalAmount <= 0) {
        return next(new ErrorHandler("Valid total amount is required", 400));
      }

      // Group items by shopId
      const shopItemsMap = new Map();
      let calculatedTotal = 0;

      for (const item of items) {
        if (
          !item.itemId ||
          !item.shopId ||
          !item.quantity ||
          item.quantity < 1 ||
          !item.name ||
          !item.price ||
          item.price < 0
        ) {
          return next(
            new ErrorHandler(
              "Invalid item: itemId, shopId, quantity, name, and price are required",
              400
            )
          );
        }

        // Validate ObjectIds
        if (!mongoose.Types.ObjectId.isValid(item.itemId)) {
          return next(
            new ErrorHandler(`Invalid product ID: ${item.itemId}`, 400)
          );
        }
        if (!mongoose.Types.ObjectId.isValid(item.shopId)) {
          return next(new ErrorHandler(`Invalid shop ID: ${item.shopId}`, 400));
        }

        // Fetch product and validate
        const product = await Product.findById(item.itemId).select(
          "price stock shop name status"
        );
        if (!product) {
          return next(
            new ErrorHandler(`Product not found: ${item.itemId}`, 404)
          );
        }
        if (!product.shop) {
          console.error("create-order: Product missing shop reference", {
            itemId: item.itemId,
            productName: product.name,
          });
          return next(
            new ErrorHandler(
              `Product ${item.itemId} has no associated shop`,
              400
            )
          );
        }

        // Normalize shopId for comparison
        const productShopId = product.shop._id
          ? product.shop._id.toString()
          : product.shop.toString();
        const requestShopId = item.shopId.toString().trim();
        console.info("create-order: Shop ID comparison", {
          itemId: item.itemId,
          productShopId,
          requestShopId,
          rawShopField: product.shop,
          match: productShopId === requestShopId,
        });

        if (productShopId !== requestShopId) {
          return next(
            new ErrorHandler(
              `Product ${item.itemId} does not belong to shop ${item.shopId}`,
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
        if (product.status !== "publish" && product.status !== "active") {
          return next(
            new ErrorHandler(`Product is not active: ${product.name}`, 400)
          );
        }

        const shopId = item.shopId;
        if (!shopItemsMap.has(shopId)) {
          shopItemsMap.set(shopId, []);
        }
        shopItemsMap.get(shopId).push({
          itemType: "Product",
          itemId: item.itemId,
          name: product.name,
          quantity: item.quantity,
          price: item.price,
        });

        // Calculate total
        calculatedTotal += item.price * item.quantity;
      }

      // Validate totalAmount
      if (Math.abs(calculatedTotal - totalAmount) > 0.01) {
        return next(new ErrorHandler("Total amount does not match items", 400));
      }

      // Create orders per shop
      const orders = [];
      for (const [shopId, orderItems] of shopItemsMap) {
        const shop = await Shop.findById(shopId);
        if (!shop) {
          return next(new ErrorHandler(`Shop not found: ${shopId}`, 404));
        }
        if (!shop.isVerified) {
          return next(new ErrorHandler(`Shop is not verified: ${shopId}`, 403));
        }

        const orderTotal = orderItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );

        const order = await Order.create({
          shop: shopId,
          customer: req.user._id,
          items: orderItems,
          totalAmount: orderTotal,
          paymentStatus: paymentInfo?.status || "Pending",
          shippingAddress,
          status: "Pending",
          statusHistory: [
            {
              status: "Pending",
              reason: "Order created",
              updatedAt: new Date(),
            },
          ],
        });

        // Send email notification to seller
        try {
          await sendMail({
            email: shop.email,
            subject: `New Order Received - Order #${order._id}`,
            message: `Dear ${
              shop.name
            },\n\nA new order has been placed in your shop.\n\nOrder ID: ${
              order._id
            }\nTotal: $${order.totalAmount.toFixed(2)}\nItems:\n${orderItems
              .map(
                (item) =>
                  `- ${item.name} (Qty: ${
                    item.quantity
                  }, Price: $${item.price.toFixed(2)})`
              )
              .join(
                "\n"
              )}\n\nPlease review and process the order in your dashboard.\n\nBest regards,\nYour E-commerce Platform`,
          });
          console.info("create-order: Email sent to seller", {
            shopId,
            orderId: order._id,
            email: shop.email,
          });
        } catch (emailError) {
          console.error("create-order: Failed to send seller email", {
            shopId,
            orderId: order._id,
            error: emailError.message,
          });
        }

        orders.push(order);
        console.info("create-order: Order created", {
          orderId: order._id,
          shopId,
          customerId: req.user._id,
          totalAmount: orderTotal,
        });
      }

      res.status(201).json({
        success: true,
        orders,
      });
    } catch (error) {
      console.error("create-order error:", {
        message: error.message,
        stack: error.stack,
        body: req.body,
        userId: req.user?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    }
  })
);

// Get single order
router.get(
  "/get-single-order/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id)
        .populate("shop", "name email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      if (order.shop._id.toString() !== req.seller._id.toString()) {
        return next(
          new ErrorHandler(
            "Unauthorized: Order does not belong to your shop",
            403
          )
        );
      }

      console.info("get-single-order: Order retrieved", {
        orderId: req.params.id,
        shopId: req.seller._id,
      });

      res.status(200).json({
        success: true,
        order,
      });
    } catch (error) {
      console.error("get-single-order error:", {
        message: error.message,
        stack: error.stack,
        orderId: req.params.id,
        shopId: req.seller?._id,
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

      const orders = await Order.find({ customer: req.params.userId })
        .sort({ createdAt: -1 })
        .populate("shop", "name email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

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
        stack: error.stack,
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
      const query = { shop: req.params.shopId };
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
        .populate("shop", "name email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

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
        stack: error.stack,
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
      const { status, reason } = req.body;
      const order = await Order.findById(req.params.id).populate(
        "shop customer"
      );

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      // Verify seller owns the shop for this order
      if (order.shop._id.toString() !== req.seller._id.toString()) {
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

      // Update product stock
      if (status === "Shipped") {
        for (const item of order.items) {
          const product = await Product.findById(item.itemId);
          if (!product) {
            return next(
              new ErrorHandler(`Product not found: ${item.itemId}`, 404)
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
          product.sold_out = (product.sold_out || 0) + item.quantity;
          await product.save({ validateBeforeSave: false });
        }
      }

      // Update seller balance
      if (status === "Delivered") {
        const serviceCharge = order.totalAmount * 0.1;
        const sellerAmount = order.totalAmount - serviceCharge;
        await Shop.findByIdAndUpdate(
          req.seller._id,
          { $inc: { pendingBalance: sellerAmount } },
          { runValidators: false } // Bypass full validation
        );
        order.paymentStatus = "Paid";
      }

      // Update status and history
      order.status = status;
      order.statusHistory.push({
        status,
        updatedAt: new Date(),
        reason: reason || `Status updated to ${status}`,
      });

      await order.save({ validateBeforeSave: false });

      // Send email notification to customer
      try {
        const customerName = order.customer?.username || "Customer";
        await sendMail({
          email: order.customer.email,
          subject: `Order Update - Order #${order._id}`,
          message: `Dear ${customerName},\n\nYour order has been updated.\n\nOrder ID: ${
            order._id
          }\nStatus: ${status}\nTotal: $${order.totalAmount.toFixed(2)}\n${
            reason ? `Reason: ${reason}\n` : ""
          }Items:\n${order.items
            .map(
              (item) =>
                `- ${item.name} (Qty: ${
                  item.quantity
                }, Price: $${item.price.toFixed(2)})`
            )
            .join(
              "\n"
            )}\n\nView details in your account.\n\nBest regards,\nYour E-commerce Platform`,
        });
        console.info("update-order-status: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          email: order.customer.email,
          status,
        });
      } catch (emailError) {
        console.error("update-order-status: Failed to send customer email", {
          orderId: order._id,
          customerId: order.customer._id,
          error: emailError.message,
        });
      }

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
        stack: error.stack,
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
      const order = await Order.findById(req.params.id).populate("customer");

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      if (order.customer._id.toString() !== req.user._id.toString()) {
        return next(
          new ErrorHandler("Unauthorized to request refund for this order", 403)
        );
      }

      if (status !== "Refunded") {
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
      order.statusHistory.push({
        status,
        updatedAt: new Date(),
        reason,
      });

      await order.save({ validateBeforeSave: false });

      // Send email notification to customer
      try {
        const customerName = order.customer?.username || "Customer";
        await sendMail({
          email: order.customer.email,
          subject: `Refund Request Submitted - Order #${order._id}`,
          message: `Dear ${customerName},\n\nYour refund request has been submitted.\n\nOrder ID: ${
            order._id
          }\nStatus: ${status}\nReason: ${reason}\nTotal: $${order.totalAmount.toFixed(
            2
          )}\n\nWe will review your request and update you soon.\n\nBest regards,\nYour E-commerce Platform`,
        });
        console.info("order-refund: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          email: order.customer.email,
        });
      } catch (emailError) {
        console.error("order-refund: Failed to send customer email", {
          orderId: order._id,
          customerId: order.customer._id,
          error: emailError.message,
        });
      }

      console.info("order-refund: Refund requested", {
        orderId: order._id,
        customerId: req.user._id,
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
        stack: error.stack,
        orderId: req.params.id,
        customerId: req.user?._id,
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
      const order = await Order.findById(req.params.id).populate(
        "shop customer"
      );

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      // Verify seller owns the shop
      if (order.shop._id.toString() !== req.seller._id.toString()) {
        return next(
          new ErrorHandler(
            "Unauthorized: Order does not belong to your shop",
            403
          )
        );
      }

      if (status !== "Refunded") {
        return next(
          new ErrorHandler("Invalid status for refund approval", 400)
        );
      }

      if (order.status !== "Refunded") {
        return next(
          new ErrorHandler("Order must be in 'Refunded' status", 400)
        );
      }

      // Restore product stock
      for (const item of order.items) {
        const product = await Product.findById(item.itemId);
        if (!product) {
          return next(
            new ErrorHandler(`Product not found: ${item.itemId}`, 404)
          );
        }
        product.stock += item.quantity;
        product.sold_out = Math.max(0, (product.sold_out || 0) - item.quantity);
        await product.save({ validateBeforeSave: false });
      }

      // Update balance
      await Shop.findByIdAndUpdate(
        req.seller._id,
        { $inc: { pendingBalance: -order.totalAmount } },
        { runValidators: false } // Bypass full validation
      );

      order.status = status;
      order.statusHistory.push({
        status,
        updatedAt: new Date(),
        reason: reason || "Refund approved",
      });
      order.paymentStatus = "Refunded";

      await order.save();

      // Send email notification to customer
      try {
        const customerName = order.customer?.username || "Customer";
        await sendMail({
          email: order.customer.email,
          subject: `Refund Approved - Order #${order._id}`,
          message: `Dear ${customerName},\n\nYour refund has been approved.\n\nOrder ID: ${
            order._id
          }\nTotal: $${order.totalAmount.toFixed(2)}\nReason: ${
            reason || "Refund approved"
          }\n\nThe amount will be processed to your account soon.\n\nBest regards,\nYour E-commerce Platform`,
        });
        console.info("order-refund-success: Email sent to customer", {
          orderId: order._id,
          customerId: order.customer._id,
          email: order.customer.email,
        });
      } catch (emailError) {
        console.error("order-refund-success: Failed to send customer email", {
          orderId: order._id,
          customerId: order.customer._id,
          error: emailError.message,
        });
      }

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
        stack: error.stack,
        orderId: req.params.id,
        shopId: req.seller?._id,
      });
      return next(new ErrorHandler(error.message, error.statusCode || 500));
    }
  })
);

// Delete order (seller)
router.delete(
  "/delete-order/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id).populate("shop");

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      if (order.shop._id.toString() !== req.seller._id.toString()) {
        return next(
          new ErrorHandler(
            "Unauthorized: Order does not belong to your shop",
            403
          )
        );
      }

      // Only allow deletion for Pending or Cancelled orders
      if (!["Pending", "Cancelled"].includes(order.status)) {
        return next(
          new ErrorHandler(
            "Only Pending or Cancelled orders can be deleted",
            400
          )
        );
      }

      await Order.deleteOne({ _id: req.params.id });

      console.info("delete-order: Order deleted", {
        orderId: req.params.id,
        shopId: req.seller._id,
        status: order.status,
      });

      res.status(200).json({
        success: true,
        message: "Order deleted successfully",
      });
    } catch (error) {
      console.error("delete-order error:", {
        message: error.message,
        stack: error.stack,
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
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("shop", "name email")
        .populate(
          "customer",
          "username fullname.firstName fullname.lastName email"
        );

      const total = await Order.countDocuments(query);

      console.info("admin-all-orders: Orders retrieved", {
        orderCount: orders.length,
        page,
        limit,
        status,
      });

      res.status(200).json({
        success: true,
        orders,
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("admin-all-orders error:", {
        message: error.message,
        stack: error.stack,
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
        { $match: { shop: new mongoose.Types.ObjectId(shopId) } },
        {
          $facet: {
            totalSales: [
              { $match: { status: { $in: ["Delivered", "Refunded"] } } },
              { $group: { _id: null, total: { $sum: "$totalAmount" } } },
            ],
            pendingOrders: [
              { $match: { status: { $in: ["Pending", "Confirmed"] } } },
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
        stack: error.stack,
        shopId: req.params.shopId,
      });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
