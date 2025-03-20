import { PlaywrightModule, PlaywrightService } from '@daechanjo/playwright';
import { RabbitMQModule } from '@daechanjo/rabbitmq';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Module, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { Queue } from 'bull';

import { CoupangMessageController } from './api/coupang.message.controller';
import { TypeormConfig } from './config/typeorm.config';
import { CoupangApiService } from './core/coupang.api.service';
import { MessageQueueProcessor } from './core/coupang.queue.processor';
import { CoupangService } from './core/coupang.service';
import { CoupangSignatureService } from './core/coupang.signature.service';
import { CoupangCrawlerService } from './core/crawler/coupang.crawler.service';
import { CrawlCoupangDetailProductsProvider } from './core/crawler/provider/crawlCoupangDetailProducts.provider';
import { DeleteConfirmedCoupangProductProvider } from './core/crawler/provider/deleteConfirmedCoupangProduct.provider';
import { InvoiceUploaderProvider } from './core/crawler/provider/invoiceUploader.provider';
import { OrderStatusUpdateProvider } from './core/crawler/provider/orderStatusUpdate.provider';
import { CoupangProductEntity } from './infrastructure/entities/coupangProduct.entity';
import { CoupangRepository } from './infrastructure/repository/coupang.repository';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '/Users/daechanjo/codes/project/auto-store/.env',
    }),
    TypeOrmModule.forRootAsync(TypeormConfig),
    TypeOrmModule.forFeature([CoupangProductEntity]),
    BullModule.registerQueueAsync({
      name: 'coupang-message-queue',
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
        },
        prefix: '{bull}',
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 3,
          backoff: 30000,
        },
        limiter: {
          max: 1,
          duration: 1000,
        },
      }),
      inject: [ConfigService],
    }),
    ConfigModule,
    RedisModule,
    PlaywrightModule,
    RabbitMQModule,
  ],
  controllers: [CoupangMessageController],
  providers: [
    CoupangService,
    CoupangSignatureService,
    CoupangCrawlerService,
    CoupangRepository,
    MessageQueueProcessor,
    CoupangApiService,
    OrderStatusUpdateProvider,
    InvoiceUploaderProvider,
    DeleteConfirmedCoupangProductProvider,
    CrawlCoupangDetailProductsProvider,
  ],
})
export class AppModule implements OnApplicationBootstrap, OnModuleInit {
  constructor(
    @InjectQueue('coupang-message-queue') private readonly queue: Queue,
    private readonly playwrightService: PlaywrightService,
    private readonly coupangApiService: CoupangApiService,
  ) {}

  async onApplicationBootstrap() {
    setTimeout(async () => {
      await this.playwrightService.init(true, 'chromium');
    });
  }

  async onModuleInit() {
    await this.queue.clean(0, 'delayed'); // 지연된 작업 제거
    await this.queue.clean(0, 'wait'); // 대기 중인 작업 제거
    await this.queue.clean(0, 'active'); // 활성 작업 제거
    await this.queue.empty(); // 모든 대기 중인 작업 제거 (옵션)
    console.log('Bull 대기열 초기화');
  }
}
