import { QueryPageDTO } from './QueryPageDTO';
import { Chain, OrderTag } from '../../utils/enums';

export class QueryCollectibleOfCollectionDTO extends QueryPageDTO {
  chain: Chain;
  collection: string;
  status?: OrderTag[];
  token?: string[];
  sort?: string;
  minPrice?: number;
  maxPrice?: number;
}
