import { Module } from '@nestjs/common';
import { DeploymentsService } from './deployments.service';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsGateway } from './deployments.gateway';
import { ApplicationsModule } from '../applications/applications.module';
import { ServersModule } from '../servers/servers.module';
import { ExecutionModule } from '../execution/execution.module';
import { ProxyModule } from '../proxy/proxy.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ApplicationsModule, ServersModule, ExecutionModule, ProxyModule, AuthModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService, DeploymentsGateway],
  exports: [DeploymentsService, DeploymentsGateway],
})
export class DeploymentsModule {}
