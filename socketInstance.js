let ioInstance = null;

const setIo = (io) => {
  ioInstance = io;
};

const getIo = () => {
  if (!ioInstance) {
    throw new Error("Socket.io instance not initialized");
  }
  return ioInstance;
};

const getReceiverSocketId = (receiverId) => {
  return require("./socket/socket").getReceiverSocketId(receiverId);
};



module.exports = { setIo, getIo, getReceiverSocketId };
