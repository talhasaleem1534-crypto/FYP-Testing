import { Module } from '@nestjs/common';
import { AppTypesController } from './app-types.controller';

@Module({
  controllers: [AppTypesController],
})
export class AppTypesModule {}
