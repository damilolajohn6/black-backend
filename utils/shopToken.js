const sendShopToken = (shop, statusCode, res, token) => {
  res.cookie("seller_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  });
  res.status(statusCode).json({
    success: true,
    seller: {
      _id: shop._id,
      name: shop.name,
      email: shop.email,
      role: shop.role,
      avatar: shop.avatar,
      address: shop.address,
      zipCode: shop.zipCode,
      phoneNumber: shop.phoneNumber,
      isVerified: shop.isVerified,
    },
    token,
  });
};

module.exports = sendShopToken;
