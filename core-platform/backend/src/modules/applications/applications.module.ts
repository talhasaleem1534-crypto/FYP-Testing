import { Module } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './applications.controller';
import { ServersModule } from '../servers/servers.module';
import { ExecutionModule } from '../execution/execution.module';
import { PortsModule } from '../ports/ports.module';
import { ProxyModule } from '../proxy/proxy.module';

@Module({
  imports: [ServersModule, ExecutionModule, PortsModule, ProxyModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
