import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServersModule } from './modules/servers/servers.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { DeploymentsModule } from './modules/deployments/deployments.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ProxyModule } from './modules/proxy/proxy.module';
import { AuthModule } from './modules/auth/auth.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { PortsModule } from './modules/ports/ports.module';
import { PersistenceModule } from './modules/persistence/persistence.module';
import { AppTypesModule } from './modules/app-types/app-types.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PersistenceModule,
    ExecutionModule,
    PortsModule,
    AuthModule,
    ServersModule,
    ApplicationsModule,
    DeploymentsModule,
    WebhooksModule,
    ProxyModule,
    AppTypesModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
