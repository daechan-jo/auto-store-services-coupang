import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CoupangProductEntity } from '../entities/coupangProduct.entity';

export class CoupangRepository {
  constructor(
    @InjectRepository(CoupangProductEntity)
    private readonly coupangRepository: Repository<CoupangProductEntity>,
  ) {}

  async saveCoupangProductDetails(details: Partial<CoupangProductEntity>[]) {
    await this.coupangRepository.save(details);
  }

  async getCoupangProducts() {
    return await this.coupangRepository.find();
  }

  async clearCoupangProducts() {
    return await this.coupangRepository.delete({});
  }
}
