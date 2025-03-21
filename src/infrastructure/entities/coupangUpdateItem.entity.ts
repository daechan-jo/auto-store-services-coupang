import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'coupang_update_item' })
export class CoupangUpdateItemEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'vendor_item_id', type: 'bigint', nullable: true })
  vendorItemId: number;

  @Column({ name: 'seller_product_id', type: 'varchar', length: 255, nullable: true })
  sellerProductId: string;

  @Column({ name: 'item_name', type: 'varchar', length: 255, nullable: true })
  itemName: string;

  @Column({ name: 'new_price', type: 'int', nullable: true })
  newPrice: number;

  @Column({ name: 'current_price', type: 'int', nullable: true })
  currentPrice: number;

  @Column({ name: 'current_is_winner', type: 'boolean', nullable: true })
  currentIsWinner: boolean;

  @Column({ name: 'cron_id', type: 'varchar', unique: false })
  cronId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
