import { AdjustData } from '@daechanjo/models';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CoupangProductEntity } from '../entities/coupangProduct.entity';
import { CoupangUpdateItemEntity } from '../entities/coupangUpdateItem.entity';

export class CoupangRepository {
  constructor(
    @InjectRepository(CoupangProductEntity)
    private readonly coupangProductRepository: Repository<CoupangProductEntity>,
    @InjectRepository(CoupangUpdateItemEntity)
    private readonly coupangUpdateItemRepository: Repository<CoupangUpdateItemEntity>,
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

  async clearCoupangProducts() {
    return await this.coupangProductRepository.delete({});
  }

  async getUpdatedItems(cronId: string) {
    return this.coupangUpdateItemRepository.find({
      where: { cronId: cronId },
    });
  }
}
