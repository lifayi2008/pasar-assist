import mongoose, { Connection, Model } from 'mongoose';

export const TokenRegisteredEventSchema = new mongoose.Schema(
  {
    blockNumber: Number,
    transactionHash: String,
    chain: String,
    token: String,
    owner: String,
    name: String,
    uri: String,
    eventType: Number,
    gasFee: Number,
    timestamp: Number,
  },
  { versionKey: false },
);

export function getTokenRegisteredEventModel(connection: Connection): Model<any> {
  return connection.model('collection_events', TokenRegisteredEventSchema);
}
