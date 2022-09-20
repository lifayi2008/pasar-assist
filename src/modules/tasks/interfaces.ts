export interface ContractTokenInfo {
  tokenId: string;
  tokenIndex: number;
  totalSupply: number;
  tokenOwner: string;
  tokenUri: string;
  royaltyOwner: string;
  royaltyFee: number;
  tokenMinter: string;
  createTime: number;
  updateTime: number;
  chain: string;
  contract: string;
}

export interface ContractOrderInfo {
  orderId: number;
  orderType: OrderType;
  orderState: OrderState;
  baseToken: string;
  tokenId: string;
  amount: number;
  quoteToken: string;
  price: number;
  reservedPrice: number;
  buyoutPrice: number;
  startTime: number;
  endTime: number;
  sellerAddr: string;
  buyerAddr: string;
  bids: number;
  lastBidder: string;
  lastBid: number;
  filled: number;
  royaltyOwner: string;
  royaltyOwners: string[];
  royaltyFee: number;
  royaltyFees: number[];
  royaltyFeeTotal: number;
  sellerUri: string;
  buyerUri: string;
  platformAddr: string;
  platformFee: number;
  isBlindBox: boolean;
  createTime: number;
  updateTime: number;
  chain: string;
}

export interface ContractUserInfo {
  did: string;
  description: string;
  name: string;
}

interface TokenData {
  image: string;
  kind: string;
  size: number;
  thumbnail: string;
  signature: string;
}

export interface TokenProperties {
  [key: string]: string;
}

export interface IPFSTokenInfo {
  version: number;
  type: string;
  name: string;
  description: string;
  creator: ContractUserInfo;
  data: TokenData;
  adult: boolean;
  properties: TokenProperties;

  image: string;
  kind: string;
  size: number;
  thumbnail: string;
}

export enum OrderEventType {
  OrderForAuction,
  OrderBid,
  OrderForSale,
  OrderFilled,
  OrderCancelled,
  OrderPriceChanged,
  OrderTakenDown,
}

export enum OrderType {
  Sale = 1,
  Auction,
}

export enum OrderState {
  Created = 1,
  Filled,
  Cancelled,
  TakenDown,
}
