import { Module } from '@nestjs/common';
import { PortManagerService } from './port-manager.service';

@Module({
  providers: [PortManagerService],
  exports: [PortManagerService],
})
export class PortsModule {}
