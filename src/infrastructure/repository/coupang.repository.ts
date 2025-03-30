import { AdjustData, CoupangPriceComparisonData } from '@daechanjo/models';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CoupangComparisonEntity } from '../entities/coupangComparison.entity';
import { CoupangProductEntity } from '../entities/coupangProduct.entity';
import { CoupangUpdateItemEntity } from '../entities/coupangUpdateItem.entity';

export class CoupangRepository {
  constructor(
    @InjectRepository(CoupangProductEntity)
    private readonly coupangProductRepository: Repository<CoupangProductEntity>,
    @InjectRepository(CoupangUpdateItemEntity)
    private readonly coupangUpdateItemRepository: Repository<CoupangUpdateItemEntity>,
    @InjectRepository(CoupangComparisonEntity)
    private readonly coupangComparisonRepository: Repository<CoupangComparisonEntity>,
  ) {}

  async saveUpdatedCoupangItems(items: AdjustData[], cronId: string) {
    const productsWithVersion = items.map((item) => ({
      ...item,
      cronId: cronId,
    }));

    return await this.coupangUpdateItemRepository.save(productsWithVersion);
  }

  async saveCoupangProductDetails(details: Partial<CoupangProductEntity>[]) {
    await this.coupangProductRepository.save(details);
  }

  async getCoupangProducts() {
    return await this.coupangProductRepository.find();
  }

  async clearCoupangComparison() {
    return await this.coupangComparisonRepository.delete({});
  }

  async getUpdatedItems(cronId: string) {
    return this.coupangUpdateItemRepository.find({
      where: { cronId: cronId },
    });
  }

  async savePriceComparison(comparisonData: CoupangPriceComparisonData[]) {
    await this.coupangComparisonRepository.save(comparisonData);
  }

  async getComparisonCount() {
    return await this.coupangComparisonRepository.count();
  }
}
