import { Module } from '@nestjs/common';
import { ServersService } from './servers.service';
import { ServersController } from './servers.controller';
import { PlatformKeyService } from './platform-key.service';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [ExecutionModule],
  controllers: [ServersController],
  providers: [ServersService, PlatformKeyService],
  exports: [ServersService, PlatformKeyService],
})
export class ServersModule {}
