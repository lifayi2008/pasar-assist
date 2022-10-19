import { Body, Controller, Get, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { CommonResponse } from '../utils/interfaces';
import { QueryLatestBidsDTO } from './dto/QueryLatestBidsDTO';
import { Category, Chain, OrderTag } from '../utils/enums';
import { QueryMarketplaceDTO } from './dto/QueryMarketplaceDTO';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/check')
  async check(): Promise<CommonResponse> {
    return await this.appService.check();
  }

  @Get('/getTokenOrderByTokenId')
  async getTokenOrderByTokenId(@Query('tokenId') tokenId: string): Promise<CommonResponse> {
    return await this.appService.getTokenOrderByTokenId(tokenId);
  }

  @Get('/getTransHistoryByTokenId')
  async getTransHistoryByTokenId(@Query('tokenId') tokenId: string): Promise<CommonResponse> {
    return await this.appService.getTransHistoryByTokenId(tokenId);
  }

  @Post('/getLatestBids')
  async getLatestBids(@Body() dto: QueryLatestBidsDTO): Promise<CommonResponse> {
    return await this.appService.getLatestBids(dto);
  }

  @Get('/getEarnedByAddress')
  async getEarnedByAddress(@Query('address') address: string): Promise<CommonResponse> {
    return await this.appService.getEarnedByAddress(address, false, false);
  }

  @Get('/getTodayEarnedByAddress')
  async getTodayEarnedByAddress(@Query('address') address: string): Promise<CommonResponse> {
    return await this.appService.getEarnedByAddress(address, true, false);
  }

  @Get('/getEarnedListByAddress')
  async getEarnedListByAddress(@Query('address') address: string): Promise<CommonResponse> {
    return await this.appService.getEarnedByAddress(address, false, true);
  }

  @Get('/getTokenPriceHistory')
  async getTokenPriceHistory(@Query('tokenId') tokenId: string): Promise<CommonResponse> {
    return await this.appService.getTokenPriceHistory(tokenId);
  }

  @Get('/getDidByAddress/:address')
  async getDidByAddress(@Query('address') address: string): Promise<CommonResponse> {
    return await this.appService.getDidByAddress(address);
  }

  @Get('/listStickers')
  async listStickers(
    @Query('pageNum') pageNum: number,
    @Query('pageSize') pageSize: number,
    @Query('timeOrder') timeOrder: number = -1,
  ): Promise<CommonResponse> {
    return await this.appService.listStickers(pageNum, pageSize, timeOrder);
  }

  @Get('/search/:key')
  async search(@Query('key') key: string): Promise<CommonResponse> {
    return await this.appService.search(key);
  }

  @Get('/listTrans')
  async listTrans(
    @Query('pageNum') pageNum: number,
    @Query('pageSize') pageSize: number,
    @Query('timeOrder') timeOrder: number = -1,
  ): Promise<CommonResponse> {
    return await this.appService.listTrans(pageNum, pageSize, timeOrder);
  }

  @Get('/nftnumber')
  async nftNumber(): Promise<CommonResponse> {
    return await this.appService.nftNumber();
  }

  @Get('/relatednftnum')
  async relatedNftNumber(): Promise<CommonResponse> {
    return await this.appService.relatedNftNumber();
  }

  @Get('/owneraddressnum')
  async ownerAddressNumber(): Promise<CommonResponse> {
    return await this.appService.ownerAddressNumber();
  }

  @Get('/gettv')
  async getTotalVolume(): Promise<CommonResponse> {
    return await this.appService.getTotalVolume();
  }

  @Get('/getNftPriceByTokenId/:tokenId/:baseToken')
  async getNftPriceByTokenId(
    @Query('tokenId') tokenId: string,
    @Query('baseToken') baseToken: string,
  ): Promise<CommonResponse> {
    return await this.appService.getNftPriceByTokenId(tokenId, baseToken);
  }

  @Get('/getTranDetailsByTokenId')
  async getTranDetailsByTokenId(
    @Query('tokenId') tokenId: string,
    @Query('baseToken') baseToken: string,
    @Query('timeOrder') timeOrder: number = -1,
  ): Promise<CommonResponse> {
    return await this.appService.getTranDetailsByTokenId(tokenId, baseToken, timeOrder);
  }

  @Get('/getCollectibleByTokenId/:tokenId/:baseToken')
  async getCollectibleByTokenId(
    @Query('tokenId') tokenId: string,
    @Query('baseToken') baseToken: string,
  ): Promise<CommonResponse> {
    return await this.appService.getCollectibleByTokenId(tokenId, baseToken);
  }

  @Get('/getTotalRoyaltyandTotalSaleByWalletAddr/:walletAddr')
  async getTotalRoyaltyAndTotalSaleByWalletAddr(
    @Query('walletAddr') walletAddr: string,
    @Query('type') type: number = 0,
  ): Promise<CommonResponse> {
    return await this.appService.getTotalRoyaltyAndTotalSaleByWalletAddr(walletAddr);
  }

  @Get('/getStastisDataByWalletAddr/:walletAddr')
  async getStatisticDataByWalletAddr(
    @Query('walletAddr') walletAddr: string,
  ): Promise<CommonResponse> {
    return await this.appService.getStatisticDataByWalletAddr(walletAddr);
  }

  @Get('/listCollectibles')
  async listCollectibles(
    @Query('pageNum', ParseIntPipe) pageNum: number = 1,
    @Query('pageSize', ParseIntPipe) pageSize: number = 10,
    @Query('type') type: string = '',
    @Query('after', ParseIntPipe) after: number = 0,
  ): Promise<CommonResponse> {
    return await this.appService.listCollectibles(pageNum, pageSize, type, after);
  }

  @Get('/listCollections')
  async listCollections(
    @Query('pageNum', ParseIntPipe) pageNum: number = 1,
    @Query('pageSize', ParseIntPipe) pageSize: number = 10,
    @Query('chain') type: Chain | 'all' = 'all',
    @Query('category') category: Category | 'all' = 'all',
    @Query('sort') sort: string = '',
  ): Promise<CommonResponse> {
    return await this.appService.listCollections(pageNum, pageSize, type, category, sort);
  }

  @Post('/marketplace')
  async getMarketplace(@Body() dto: QueryMarketplaceDTO): Promise<CommonResponse> {
    return await this.appService.getMarketplace(dto);
  }

  @Get('/listNFTs')
  async listNFTs(
    @Query('pageNum', ParseIntPipe) pageNum: number = 1,
    @Query('pageSize', ParseIntPipe) pageSize: number = 10,
    @Query('sort') sort: 1 | -1 = -1,
  ): Promise<CommonResponse> {
    return await this.appService.listNFTs(pageNum, pageSize, sort);
  }

  @Get('/listTransactions')
  async listTransactions(
    @Query('pageNum', ParseIntPipe) pageNum: number = 1,
    @Query('pageSize', ParseIntPipe) pageSize: number = 10,
    @Query('eventType') eventType: string = '',
    @Query('sort') sort: 1 | -1 = -1,
  ): Promise<CommonResponse> {
    return await this.appService.listTransactions(pageNum, pageSize, eventType, sort);
  }

  @Get('/getTransactionsOfToken')
  async getTransactionsByToken(
    @Query('chain') chain: Chain,
    @Query('tokenId') tokenId: string,
    @Query('baseToken') baseToken: string,
    @Query('eventType') eventType: string = '',
    @Query('sort') sort: 1 | -1 = -1,
  ): Promise<CommonResponse> {
    return await this.appService.getTransactionsByToken(chain, tokenId, baseToken, eventType, sort);
  }

  @Get('/getPriceHistoryOfToken')
  async getPriceHistoryOfToken(
    @Query('chain') chain: Chain,
    @Query('tokenId') tokenId: string,
    @Query('baseToken') baseToken: string,
  ): Promise<CommonResponse> {
    return await this.appService.getPriceHistoryOfToken(chain, tokenId, baseToken);
  }

  @Get('/getCollectibleInfo')
  async getCollectibleInfo(
    @Query('chain') chain: Chain,
    @Query('tokenId') tokenId: string,
    @Query('baseToken') baseToken: string,
  ): Promise<CommonResponse> {
    return await this.appService.getCollectibleInfo(chain, tokenId, baseToken);
  }

  @Get('/getCollectiblesOfCollection')
  async getCollectiblesOfCollection(
    @Query('chain') chain: Chain,
    @Query('collection') collection: string,
    @Query('exceptToken') exceptToken: string,
    @Query('num', ParseIntPipe) num: number = 4,
  ): Promise<CommonResponse> {
    return await this.appService.getCollectiblesOfCollection(chain, collection, exceptToken, num);
  }

  @Get('/getCollectionInfo')
  async getCollectionInfo(
    @Query('chain') chain: Chain,
    @Query('collection') collection: string,
  ): Promise<CommonResponse> {
    return await this.appService.getCollectionInfo(chain, collection);
  }

  @Get('/quickSearch')
  async quickSearch(@Query('keyword') keyword: string): Promise<CommonResponse> {
    return await this.appService.quickSearch(keyword);
  }

  @Get('/searchTokens')
  async searchTokens(@Query('keyword') keyword: string): Promise<CommonResponse> {
    return await this.appService.searchTokens(keyword);
  }

  @Get('/searchMarketplace')
  async searchMarketplace(@Query('keyword') keyword: string): Promise<CommonResponse> {
    return await this.appService.searchMarketplace(keyword);
  }
}
