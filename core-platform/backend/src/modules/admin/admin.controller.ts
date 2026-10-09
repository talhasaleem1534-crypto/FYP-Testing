import { Controller, Get } from '@nestjs/common';
import { AdminOnly } from '../auth/requester';
import { AdminService } from './admin.service';

/** Pages only the admin can see: all customers, and where their data is stored. */
@Controller('admin')
@AdminOnly()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('customers')
  customers() {
    return this.admin.customers();
  }

  @Get('storage')
  storage() {
    return this.admin.storage();
  }
}
