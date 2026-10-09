import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';

@Module({
  controllers: [AuthController],
  // APP_GUARD makes AuthGuard run before every route in the whole backend.
  providers: [AuthService, AuthGuard, { provide: APP_GUARD, useExisting: AuthGuard }],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
