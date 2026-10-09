import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { ApplicationsModule } from '../applications/applications.module';
import { DeploymentsModule } from '../deployments/deployments.module';

@Module({
  imports: [ApplicationsModule, DeploymentsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
