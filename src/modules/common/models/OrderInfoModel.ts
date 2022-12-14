import mongoose, { Connection, Model } from 'mongoose';

export const OrderInfoSchema = new mongoose.Schema(
  {
    orderId: Number,
    orderType: Number,
    orderState: Number,
    baseToken: String,
    tokenId: String,
    amount: Number,
    quoteToken: String,
    price: Number,
    endTime: Number,
    sellerAddr: String,
    buyerAddr: String,
    bids: Number,
    lastBidder: String,
    lastBid: Number,
    filled: Number,
    royaltyOwner: String,
    royaltyFee: Number,
    royaltyOwners: Array,
    royaltyFees: Array,
    royaltyFeeTotal: Number,
    sellerUri: String,
    sellerInfo: { did: String, description: String, name: String },
    buyerUri: String,
    buyerInfo: { did: String, description: String, name: String },
    platformAddr: String,
    platformFee: Number,
    isBlindBox: Boolean,
    createTime: Number,
    updateTime: Number,
    chain: String,
    contract: String,
    uniqueKey: String,
    buyoutPrice: Number,
    reservePrice: Number,
  },
  { versionKey: false },
);

export function getOrderInfoModel(connection: Connection): Model<any> {
  return connection.model('orders', OrderInfoSchema);
}
