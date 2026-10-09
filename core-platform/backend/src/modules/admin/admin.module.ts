import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { ApplicationsModule } from '../applications/applications.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { ServersModule } from '../servers/servers.module';

@Module({
  imports: [AuthModule, ApplicationsModule, DeploymentsModule, ServersModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
