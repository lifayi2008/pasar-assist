import mongoose, { Connection, Model } from 'mongoose';

export const TokenInfoSchema = new mongoose.Schema(
  {
    tokenIdHex: String,
    tokenId: String,
    tokenSupply: Number,
    tokenIndex: Number,
    tokenOwner: String,
    tokenUri: String,
    royaltyOwner: String,
    royaltyFee: Number,
    tokenMinter: String,
    createTime: Number,
    updateTime: Number,
    version: Number,
    type: String,
    name: String,
    description: String,
    creator: { did: String, description: String, name: String },
    data: { image: String, kind: String, size: Number, thumbnail: String, signature: String },
    adult: Boolean,
    properties: Object,
    blockNumber: Number,
    chain: String,
    contract: String,
    uniqueKey: String,
  },
  { versionKey: false },
);

export function getTokenInfoModel(connection: Connection): Model<any> {
  return connection.model('tokens', TokenInfoSchema);
}
