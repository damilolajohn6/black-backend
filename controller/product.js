require("dotenv").config();
const express = require("express");
const { isSeller, isAuthenticated, isAdmin } = require("../middleware/auth");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const router = express.Router();
const Product = require("../model/product");
const Order = require("../model/order");
const Shop = require("../model/shop");
const ErrorHandler = require("../utils/ErrorHandler");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create product
router.post(
  "/create-product",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      if (!req.seller || !req.seller._id) {
        console.error("create-product: Seller not authenticated", {
          cookies: req.cookies,
          headers: req.headers.authorization,
        });
        return next(new ErrorHandler("Seller not authenticated", 401));
      }

      const shopId = req.body.shopId;
      if (!shopId) {
        return next(new ErrorHandler("Shop ID is required", 400));
      }

      const shop = await Shop.findById(shopId);
      if (!shop) {
        return next(new ErrorHandler("Invalid Shop ID", 400));
      }

      if (shop._id.toString() !== req.seller._id.toString()) {
        return next(
          new ErrorHandler("Unauthorized: Shop does not belong to seller", 403)
        );
      }

      const {
        name,
        description,
        category,
        price,
        stock,
        images,
        priceDiscount,
        subCategory,
        tags,
        shipping,
        variations,
        isMadeInCanada,
        canadianCertification,
      } = req.body;

      if (!name || !description || !category || !price || stock === undefined) {
        return next(
          new ErrorHandler(
            "Missing required fields: name, description, category, price, stock",
            400
          )
        );
      }

      if (!Array.isArray(images) || images.length === 0) {
        return next(new ErrorHandler("At least one image is required", 400));
      }

      const imagesLinks = images.map((image) => ({
        public_id: image.public_id || "",
        url: image.url,
      }));

      for (const image of imagesLinks) {
        if (!image.url) {
          return next(
            new ErrorHandler("Each image must have a valid URL", 400)
          );
        }
      }

      const productData = {
        name,
        description,
        category,
        price: Number(price),
        stock: Number(stock),
        images: imagesLinks,
        shop: shop._id,
        seller: req.seller._id,
        priceDiscount: priceDiscount ? Number(priceDiscount) : undefined,
        subCategory,
        tags: tags || [],
        shipping: shipping || {},
        variations: variations || [],
        isMadeInCanada: isMadeInCanada || false,
        canadianCertification: canadianCertification || "",
      };

      const product = await Product.create(productData);
      console.info("create-product: Product created successfully", {
        productId: product._id,
        sellerId: req.seller._id,
      });
      res.status(201).json({
        success: true,
        product,
      });
    } catch (error) {
      console.error("create-product error:", {
        message: error.message,
        body: req.body,
        seller: req.seller?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Update product
router.put(
  "/update-product/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const productId = req.params.id;
      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("update-product: Invalid product ID format", {
          productId,
        });
        return next(new ErrorHandler("Invalid product ID format", 400));
      }

      const product = await Product.findById(productId).populate(
        "seller",
        "_id"
      );
      if (!product) {
        console.error("update-product: Product not found", { productId });
        return next(new ErrorHandler("Product not found", 404));
      }
      console.debug("update-product: Product fetched", {
        productId,
        sellerField: product.seller,
        reqSellerId: req.seller?._id,
      });
      if (
        !product.seller ||
        !req.seller?._id ||
        product.seller._id.toString() !== req.seller._id.toString()
      ) {
        console.error("update-product: Unauthorized access", {
          productId,
          sellerId: req.seller?._id,
          productSellerId: product.seller?._id,
        });
        return next(
          new ErrorHandler(
            "Unauthorized: Product does not belong to seller",
            403
          )
        );
      }

      const {
        name,
        description,
        category,
        price,
        stock,
        images,
        priceDiscount,
        subCategory,
        tags,
        shipping,
        variations,
        isMadeInCanada,
        canadianCertification,
      } = req.body;

      if (!name || !description || !category || !price || stock === undefined) {
        return next(
          new ErrorHandler(
            "Missing required fields: name, description, category, price, stock",
            400
          )
        );
      }

      if (!Array.isArray(images) || images.length === 0) {
        return next(new ErrorHandler("At least one image is required", 400));
      }

      const imagesLinks = images.map((image) => ({
        public_id: image.public_id || "",
        url: image.url,
      }));

      for (const image of imagesLinks) {
        if (!image.url) {
          return next(
            new ErrorHandler("Each image must have a valid URL", 400)
          );
        }
      }

      product.name = name;
      product.description = description;
      product.category = category;
      product.price = Number(price);
      product.stock = Number(stock);
      product.images = imagesLinks;
      product.priceDiscount = priceDiscount ? Number(priceDiscount) : undefined;
      product.subCategory = subCategory;
      product.tags = tags || [];
      product.shipping = shipping || {};
      product.variations = variations || [];
      product.isMadeInCanada = isMadeInCanada || false;
      product.canadianCertification = canadianCertification || "";

      await product.save();
      console.info("update-product: Product updated successfully", {
        productId,
      });

      res.status(200).json({
        success: true,
        product,
      });
    } catch (error) {
      console.error("update-product error:", {
        message: error.message,
        body: req.body,
        sellerId: req.seller?._id || "missing",
        productId,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get single product
router.get(
  "/get-product/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const productId = req.params.id;
      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("get-product: Invalid product ID format", { productId });
        return next(new ErrorHandler("Invalid product ID format", 400));
      }

      const product = await Product.findById(productId)
        .populate("shop", "name")
        .populate("seller", "_id");
      if (!product) {
        console.error("get-product: Product not found", { productId });
        return next(new ErrorHandler("Product not found", 404));
      }
      console.debug("get-product: Product fetched", {
        productId,
        sellerField: product.seller,
        reqSellerId: req.seller?._id,
      });
      if (
        !product.seller ||
        !req.seller?._id ||
        product.seller._id.toString() !== req.seller._id.toString()
      ) {
        console.error("get-product: Unauthorized access", {
          productId,
          sellerId: req.seller?._id,
          productSellerId: product.seller?._id,
        });
        return next(
          new ErrorHandler(
            "Unauthorized: Product does not belong to seller",
            403
          )
        );
      }

      console.info("get-product: Product retrieved successfully", {
        productId,
      });
      res.status(200).json({
        success: true,
        product,
      });
    } catch (error) {
      console.error("get-product error:", {
        message: error.message,
        productId: req.params.id,
        sellerId: req.seller?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Delete image from Cloudinary
router.post(
  "/delete-image",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { public_id } = req.body;
      if (!public_id) {
        return next(new ErrorHandler("Public ID is required", 400));
      }
      const result = await cloudinary.v2.uploader.destroy(public_id);
      if (result.result !== "ok" && result.result !== "not found") {
        console.error("delete-image: Cloudinary deletion failed", {
          public_id,
          result,
        });
        return next(
          new ErrorHandler("Failed to delete image from Cloudinary", 500)
        );
      }
      console.info("delete-image: Image deleted successfully", { public_id });
      res.status(200).json({
        success: true,
        message: "Image deleted successfully",
      });
    } catch (error) {
      console.error("delete-image error:", {
        message: error.message,
        public_id: req.body.public_id,
      });
      return next(new ErrorHandler("Failed to delete image", 500));
    }
  })
);

// Get all products of a shop
router.get(
  "/get-all-products-shop/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const shopId = req.params.id;
      if (!shopId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("get-all-products-shop: Invalid shop ID format", {
          shopId,
        });
        return next(new ErrorHandler("Invalid shop ID format", 400));
      }

      const products = await Product.find({ shop: shopId })
        .populate("shop", "name")
        .populate("seller", "_id");
      console.info("get-all-products-shop: Products retrieved successfully", {
        shopId,
        productCount: products.length,
        productIds: products.map((p) => p._id.toString()),
      });
      res.status(200).json({
        success: true,
        products,
      });
    } catch (error) {
      console.error("get-all-products-shop error:", {
        message: error.message,
        shopId: req.params.id,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Delete product of a shop
router.delete(
  "/delete-shop-product/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const productId = req.params.id;
      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        console.error("delete-shop-product: Invalid product ID format", {
          productId,
        });
        return next(new ErrorHandler("Invalid product ID format", 400));
      }

      const product = await Product.findById(productId).populate(
        "seller",
        "_id"
      );
      if (!product) {
        console.error("delete-shop-product: Product not found", { productId });
        return next(new ErrorHandler("Product not found", 404));
      }
      console.debug("delete-shop-product: Product fetched", {
        productId,
        sellerField: product.seller,
        reqSellerId: req.seller?._id,
      });
      if (
        !product.seller ||
        !req.seller?._id ||
        product.seller._id.toString() !== req.seller._id.toString()
      ) {
        console.error("delete-shop-product: Unauthorized access", {
          productId,
          sellerId: req.seller?._id,
          productSellerId: product.seller?._id,
        });
        return next(
          new ErrorHandler(
            "Unauthorized: Product does not belong to seller",
            403
          )
        );
      }

      // Delete images from Cloudinary with error handling
      for (const image of product.images) {
        if (image.public_id) {
          try {
            const result = await cloudinary.v2.uploader.destroy(
              image.public_id
            );
            if (result.result !== "ok" && result.result !== "not found") {
              console.warn("delete-shop-product: Cloudinary deletion failed", {
                public_id: image.public_id,
                result,
              });
            } else {
              console.info("delete-shop-product: Image deleted", {
                public_id: image.public_id,
              });
            }
          } catch (error) {
            console.warn("delete-shop-product: Cloudinary deletion error", {
              public_id: image.public_id,
              message: error.message,
            });
            // Continue deletion even if Cloudinary fails
          }
        }
      }

      await Product.deleteOne({ _id: productId });
      console.info("delete-shop-product: Product deleted successfully", {
        productId,
      });

      res.status(200).json({
        success: true,
        message: "Product deleted successfully",
      });
    } catch (error) {
      console.error("delete-shop-product error:", {
        message: error.message,
        productId: req.params.id,
        sellerId: req.seller?._id || "missing",
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all products
router.get(
  "/get-all-products",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const products = await Product.find()
        .sort({ createdAt: -1 })
        .populate("shop", "name")
        .populate("seller", "_id");
      console.info("get-all-products: Products retrieved successfully", {
        productCount: products.length,
      });
      res.status(200).json({
        success: true,
        products,
      });
    } catch (error) {
      console.error("get-all-products error:", { message: error.message });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Create or update product review
router.put(
  "/create-new-review",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { user, rating, comment, productId, orderId } = req.body;

      if (!rating || !comment || !productId || !orderId) {
        return next(
          new ErrorHandler("Missing required fields for review", 400)
        );
      }

      const product = await Product.findById(productId).populate(
        "seller",
        "_id"
      );
      if (!product) {
        return next(new ErrorHandler("Product not found", 404));
      }

      const order = await Order.findById(orderId);
      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      const cartItem = order.cart.find(
        (item) => item._id.toString() === productId.toString()
      );
      if (!cartItem) {
        return next(new ErrorHandler("Product not found in order", 400));
      }

      const review = {
        user: req.user._id,
        name: req.user.name,
        rating: Number(rating),
        comment,
        createdAt: new Date(),
      };

      const existingReview = product.reviews.find(
        (rev) => rev.user.toString() === req.user._id.toString()
      );

      if (existingReview) {
        product.reviews = product.reviews.map((rev) =>
          rev.user.toString() === req.user._id.toString() ? review : rev
        );
      } else {
        product.reviews.push(review);
      }

      product.ratingsQuantity = product.reviews.length;
      product.ratingsAverage =
        product.reviews.reduce((acc, rev) => acc + rev.rating, 0) /
          product.ratingsQuantity || 0;

      await product.save({ validateBeforeSave: false });

      // Update order
      order.cart = order.cart.map((item) =>
        item._id.toString() === productId.toString()
          ? { ...item, isReviewed: true }
          : item
      );
      await order.save();

      console.info("create-new-review: Review submitted successfully", {
        productId,
        userId: req.user._id,
      });
      res.status(200).json({
        success: true,
        message: "Review submitted successfully",
      });
    } catch (error) {
      console.error("create-new-review error:", {
        message: error.message,
        body: req.body,
      });
      return next(new ErrorHandler(error.message, 400));
    }
  })
);

// Get all products (admin)
router.get(
  "/admin-all-products",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const products = await Product.find()
        .sort({ createdAt: -1 })
        .populate("shop", "name")
        .populate("seller", "_id");
      console.info("admin-all-products: Products retrieved successfully", {
        productCount: products.length,
      });
      res.status(200).json({
        success: true,
        products,
      });
    } catch (error) {
      console.error("admin-all-products error:", { message: error.message });
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
