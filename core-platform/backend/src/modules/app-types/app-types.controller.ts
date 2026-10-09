import { Controller, Get } from '@nestjs/common';
import { publicAppTypes } from './app-types';
import { Public } from '../auth/requester';

@Controller('app-types')
@Public()
export class AppTypesController {
  /** The list of app types the customer can pick from when creating an application. */
  @Get()
  list() {
    return publicAppTypes();
  }
}
