import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'coupang_update_item' })
export class CoupangUpdateItemEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'vendor_item_id', type: 'bigint', nullable: false })
  vendorItemId: number;

  @Column({ name: 'product_name', type: 'varchar', length: 255, nullable: false })
  productName: string;

  @Column({ name: 'new_price', type: 'int', nullable: false })
  newPrice: number;

  @Column({ name: 'current_price', type: 'int', nullable: false })
  currentPrice: number;

  @Column({ name: 'winner_price', type: 'int', nullable: false })
  winnerPrice: number;

  @Column({ name: 'seller_price', type: 'int', nullable: false })
  sellerPrice: number;

  @Column({ name: 'cron_id', type: 'varchar', unique: false })
  cronId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
