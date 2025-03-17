import { PlaywrightModule, PlaywrightService } from '@daechanjo/playwright';
import { RabbitMQModule } from '@daechanjo/rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { BullModule } from '@nestjs/bull';

import { TypeormConfig } from './config/typeorm.config';
import { CoupangProduct } from './infrastructure/entities/coupangProduct.entity';
import { CoupangMessageController } from './api/coupang.message.controller';
import { CoupangService } from './core/coupang.service';
import { CoupangSignatureService } from './core/coupang.signature.service';
import { CoupangCrawlerService } from './core/coupang.crawler.service';
import { MessageQueueProcessor } from './core/coupang.queue.processor';
import { CoupangApiService } from './core/coupang.api.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '/Users/daechanjo/codes/project/auto-store/.env',
    }),
    TypeOrmModule.forRootAsync(TypeormConfig),
    TypeOrmModule.forFeature([CoupangProduct]),
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
  ],
})
export class AppModule implements OnApplicationBootstrap, OnModuleInit {
  constructor(private readonly playwrightService: PlaywrightService) {}

  async onApplicationBootstrap() {
    setTimeout(async () => {
      await this.playwrightService.init(false, 'chromium');
    });
  }

  async onModuleInit() {}
}
