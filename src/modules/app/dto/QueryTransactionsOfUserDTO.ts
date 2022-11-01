import { QueryPageDTO } from './QueryPageDTO';

export class QueryTransactionsOfUserDTO extends QueryPageDTO {
  eventType?: string[];
  sort: -1 | 1 = -1;
}
